import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellOff,
  BellRing,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Minus,
  Plus,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { api } from '../services/api.js';
import { Bill, BillStatus, Category, Order, OrderSource, OrderStatus, PaymentMethod, Product, ProductOptionGroup, SelectedOrderOption, Table, TableStatus, WaiterRequest } from '../types.js';
import { formatCad, formatOptionPriceDelta, formatTimeElapsed, getOrderSourceLabel, getOrderStatusLabel, getPaymentMethodLabel, getSelectedOptionsTotal, getTableAreaLabel, getTableDisplayLabel, getTableStatusLabel, groupSelectedOptions } from '../utils.js';

interface WaiterAlert {
  id: string;
  tableId: string;
  title: string;
  detail: string;
  tone: 'bill' | 'order' | 'call';
}

interface ManualQueueItem {
  id: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  notes?: string;
  sendToKitchen: boolean;
  selectedOptions?: SelectedOrderOption[];
}

interface ManualDraftItem {
  id: string;
  product: Product;
  quantity: number;
  notes?: string;
  selectedOptions: SelectedOrderOption[];
}

interface ManualQueuedOrder {
  id: string;
  tableId: string;
  tableNumber: number;
  tableLabel: string;
  items: ManualQueueItem[];
  notes: string;
  subtotal: number;
  createdAt: string;
}

type ProductConfigContext = 'manual' | 'pending';

function hasFinishedStatus(status: OrderStatus) {
  return [OrderStatus.DELIVERED, OrderStatus.CANCELLED].includes(status);
}

function createManualLineId() {
  return `manual-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSelectedOptionSignature(selectedOptions?: SelectedOrderOption[]) {
  return [...(selectedOptions || [])]
    .map((option) => `${option.groupId}:${option.choiceId}`)
    .sort()
    .join('|');
}

function buildSelectedOptions(product: Product, selectedChoicesByGroup: Record<string, string[]>) {
  return (product.optionGroups || []).flatMap((group) => {
    const choiceIds = selectedChoicesByGroup[group.id] || [];
    return group.choices
      .filter((choice) => choiceIds.includes(choice.id))
      .map((choice) => ({
        groupId: group.id,
        groupName: group.name,
        choiceId: choice.id,
        choiceName: choice.name,
        priceDelta: choice.priceDelta,
      }));
  });
}

function getManualLineUnitPrice(product: Product, selectedOptions?: SelectedOrderOption[]) {
  return product.price + getSelectedOptionsTotal(selectedOptions);
}

const WAITER_ALERT_SOUND_URL = new URL('../../sound.mp3', import.meta.url).href;

export default function WaiterApp({ onLogout }: { onLogout?: () => void | Promise<void> }) {
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [waiterRequests, setWaiterRequests] = useState<WaiterRequest[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [isAddingManual, setIsAddingManual] = useState(false);
  const [manualCart, setManualCart] = useState<ManualDraftItem[]>([]);
  const [manualKitchenSelections, setManualKitchenSelections] = useState<Record<string, boolean>>({});
  const [manualNote, setManualNote] = useState('');
  const [manualQueuedOrders, setManualQueuedOrders] = useState<ManualQueuedOrder[]>([]);
  const [isSendingManualQueue, setIsSendingManualQueue] = useState(false);
  const [pendingEditorOrderId, setPendingEditorOrderId] = useState<string | null>(null);
  const [pendingEditorItems, setPendingEditorItems] = useState<ManualDraftItem[]>([]);
  const [isSavingPendingEditor, setIsSavingPendingEditor] = useState(false);
  const [configProduct, setConfigProduct] = useState<Product | null>(null);
  const [configChoices, setConfigChoices] = useState<Record<string, string[]>>({});
  const [configQuantity, setConfigQuantity] = useState(1);
  const [configContext, setConfigContext] = useState<ProductConfigContext | null>(null);
  const [configLineNotes, setConfigLineNotes] = useState('');
  const [alerts, setAlerts] = useState<WaiterAlert[]>([]);
  const [highlightedTables, setHighlightedTables] = useState<Record<string, number>>({});
  const [approvalSelections, setApprovalSelections] = useState<Record<string, Record<string, boolean>>>({});
  const [isWaiterAlertLoopActive, setIsWaiterAlertLoopActive] = useState(false);
  const waiterAlertAudioRef = useRef<HTMLAudioElement | null>(null);
  const waiterAlertLoopActiveRef = useRef(false);

  const stopWaiterAlertLoop = () => {
    const audio = waiterAlertAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    waiterAlertLoopActiveRef.current = false;
    setIsWaiterAlertLoopActive(false);
  };

  const startWaiterAlertLoop = () => {
    if (waiterAlertLoopActiveRef.current) {
      return;
    }

    const audio =
      waiterAlertAudioRef.current ||
      (() => {
        const nextAudio = new Audio(WAITER_ALERT_SOUND_URL);
        nextAudio.loop = true;
        nextAudio.preload = 'auto';
        waiterAlertAudioRef.current = nextAudio;
        return nextAudio;
      })();

    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((error) => {
        console.error('Nu am putut porni sunetul pentru ospatar', error);
        waiterAlertLoopActiveRef.current = false;
        setIsWaiterAlertLoopActive(false);
      });
    }

    waiterAlertLoopActiveRef.current = true;
    setIsWaiterAlertLoopActive(true);
  };

  const testWaiterAlertSound = () => {
    if (waiterAlertLoopActiveRef.current) {
      stopWaiterAlertLoop();
      return;
    }

    startWaiterAlertLoop();
    pushAlert({
      tableId: selectedTableId || tables[0]?.id || 'waiter-audio-test',
      title: 'Test sunet ospatar pornit',
      detail: 'Sunetul ruleaza in bucla pana la prima actiune din panou sau pana apesi din nou pe buton.',
      tone: 'call',
    });
  };

  const pushAlert = (alert: Omit<WaiterAlert, 'id'>) => {
    const id = `waiter-alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAlerts((current) => [{ ...alert, id }, ...current].slice(0, 4));
    setHighlightedTables((current) => ({ ...current, [alert.tableId]: Date.now() }));

    setTimeout(() => {
      setAlerts((current) => current.filter((entry) => entry.id !== id));
    }, 5500);

    setTimeout(() => {
      setHighlightedTables((current) => {
        const next = { ...current };
        delete next[alert.tableId];
        return next;
      });
    }, 6500);
  };

  useEffect(() => {
    if (!isWaiterAlertLoopActive) {
      return;
    }

    const acknowledgeWaiterAlert = () => {
      stopWaiterAlertLoop();
    };

    const eventOptions: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener('pointerdown', acknowledgeWaiterAlert, eventOptions);
    window.addEventListener('touchstart', acknowledgeWaiterAlert, eventOptions);
    window.addEventListener('keydown', acknowledgeWaiterAlert, { capture: true });
    window.addEventListener('wheel', acknowledgeWaiterAlert, eventOptions);

    return () => {
      window.removeEventListener('pointerdown', acknowledgeWaiterAlert, eventOptions);
      window.removeEventListener('touchstart', acknowledgeWaiterAlert, eventOptions);
      window.removeEventListener('keydown', acknowledgeWaiterAlert, { capture: true });
      window.removeEventListener('wheel', acknowledgeWaiterAlert, eventOptions);
    };
  }, [isWaiterAlertLoopActive]);

  useEffect(() => {
    return () => {
      const audio = waiterAlertAudioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, []);

  const resolveWaiterRequestsForTable = async (tableId: string) => {
    const openRequests = waiterRequests.filter((request) => request.tableId === tableId && request.status === 'OPEN');
    if (openRequests.length === 0) {
      return;
    }

    try {
      await Promise.allSettled(openRequests.map((request) => api.resolveWaiterRequest(request.id)));
      setWaiterRequests((current) =>
        current.map((request) =>
          request.tableId === tableId && request.status === 'OPEN'
            ? {
                ...request,
                status: 'RESOLVED',
                updatedAt: new Date().toISOString(),
                resolvedAt: new Date().toISOString(),
              }
            : request
        )
      );
    } catch (error) {
      console.error('Nu am putut inchide notificarile de chemare ospatar', error);
    }
  };

  const fetchAllData = async () => {
    try {
      const [tableList, orderList, productList, categoryList, billList, waiterRequestList] = await Promise.all([
        api.getTables(),
        api.getOrders(),
        api.getProducts(),
        api.getCategories(),
        api.getBills(),
        api.getWaiterRequests(),
      ]);

      setTables(tableList);
      setOrders(orderList);
      setProducts(productList.filter((product) => product.available));
      setCategories(categoryList);
      setBills(billList);
      setWaiterRequests(waiterRequestList);
    } catch (error) {
      console.error('Nu am putut incarca datele pentru ospatar', error);
    }
  };

  useEffect(() => {
    if (typeof document === 'undefined' || (!configProduct && !pendingEditorOrderId)) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [configProduct, pendingEditorOrderId]);

  useEffect(() => {
    fetchAllData();

    const refresh = () => {
      fetchAllData();
    };

    const unsubTable = api.subscribe('table-update', refresh);
    const unsubOrder = api.subscribe('order-update', (order: Order) => {
      if (order.status === OrderStatus.READY) {
        pushAlert({
          tableId: order.tableId,
          title: `Comanda ${order.orderNumber} este gata`,
          detail: `Masa ${order.tableNumber} poate fi ridicata si servita.`,
          tone: 'order',
        });
        startWaiterAlertLoop();
      }
      refresh();
    });
    const unsubNewOrder = api.subscribe('new-order', refresh);
    const unsubNewOrderRequest = api.subscribe('new-order-request', (order: Order) => {
      pushAlert({
        tableId: order.tableId,
        title: `Masa ${order.tableNumber} a trimis o cerere noua`,
        detail: `${order.orderNumber} asteapta aprobarea ospatarului.`,
        tone: 'order',
      });
      startWaiterAlertLoop();
      refresh();
    });
    const unsubBill = api.subscribe('bill-update', (bill: Bill) => {
      if (bill.status === BillStatus.BILL_REQUESTED) {
        pushAlert({
          tableId: bill.tableId,
          title: `Masa ${bill.tableNumber} a cerut nota`,
          detail: `Metoda de plata: ${getPaymentMethodLabel(bill.paymentMethod || 'CASH')}.`,
          tone: 'bill',
        });
        startWaiterAlertLoop();
      }
      refresh();
    });
    const unsubNewWaiterRequest = api.subscribe('new-waiter-request', (waiterRequest: WaiterRequest) => {
      pushAlert({
        tableId: waiterRequest.tableId,
        title: `Masa ${waiterRequest.tableNumber} cheama ospatarul`,
        detail: `${waiterRequest.items.reduce((sum, item) => sum + item.quantity, 0)} produse pregatite in cos pentru discutie.`,
        tone: 'call',
      });
      startWaiterAlertLoop();
      refresh();
    });
    const unsubWaiterRequestUpdate = api.subscribe('waiter-request-update', refresh);
    const unsubDatabaseReset = api.subscribe('database-reset', refresh);
    const unsubSessionCleared = api.subscribe('session-cleared', refresh);

    return () => {
      unsubTable();
      unsubOrder();
      unsubNewOrder();
      unsubNewOrderRequest();
      unsubBill();
      unsubNewWaiterRequest();
      unsubWaiterRequestUpdate();
      unsubDatabaseReset();
      unsubSessionCleared();
    };
  }, []);

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || null,
    [selectedTableId, tables]
  );

  const pendingApprovals = useMemo(
    () => orders.filter((order) => order.status === OrderStatus.PENDING),
    [orders]
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );
  const manualProductGroups = useMemo(() => {
    const grouped = new Map<
      string,
      {
        id: string;
        icon?: string;
        name: string;
        products: Product[];
      }
    >();

    products.forEach((product) => {
      const category = categoryById.get(product.categoryId);
      const key = category?.id || 'fara-categorie';
      const existing = grouped.get(key);

      if (existing) {
        existing.products.push(product);
        return;
      }

      grouped.set(key, {
        id: key,
        icon: category?.icon,
        name: category?.name || 'Fara categorie',
        products: [product],
      });
    });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        products: group.products.slice().sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [categoryById, products]);
  const manualProductQuantities = useMemo(() => {
    const next = new Map<string, number>();
    manualCart.forEach((item) => {
      next.set(item.product.id, (next.get(item.product.id) || 0) + item.quantity);
    });
    return next;
  }, [manualCart]);
  const pendingEditorOrder = useMemo(
    () => (pendingEditorOrderId ? orders.find((order) => order.id === pendingEditorOrderId && order.status === OrderStatus.PENDING) || null : null),
    [orders, pendingEditorOrderId]
  );
  const pendingEditorProductQuantities = useMemo(() => {
    const next = new Map<string, number>();
    pendingEditorItems.forEach((item) => {
      next.set(item.product.id, (next.get(item.product.id) || 0) + item.quantity);
    });
    return next;
  }, [pendingEditorItems]);
  const manualCartItemCount = useMemo(
    () => manualCart.reduce((sum, item) => sum + item.quantity, 0),
    [manualCart]
  );
  const manualCartTotal = useMemo(
    () => manualCart.reduce((sum, item) => sum + getManualLineUnitPrice(item.product, item.selectedOptions) * item.quantity, 0),
    [manualCart]
  );
  const manualQueueItemCount = useMemo(
    () => manualQueuedOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0),
    [manualQueuedOrders]
  );
  const manualQueueTotal = useMemo(
    () => manualQueuedOrders.reduce((sum, order) => sum + order.subtotal, 0),
    [manualQueuedOrders]
  );
  const pendingEditorItemCount = useMemo(
    () => pendingEditorItems.reduce((sum, item) => sum + item.quantity, 0),
    [pendingEditorItems]
  );
  const pendingEditorTotal = useMemo(
    () => pendingEditorItems.reduce((sum, item) => sum + getManualLineUnitPrice(item.product, item.selectedOptions) * item.quantity, 0),
    [pendingEditorItems]
  );
  const readyForDelivery = useMemo(
    () => orders.filter((order) => order.status === OrderStatus.READY),
    [orders]
  );
  const attentionTableIds = useMemo(() => {
    const pendingTableIds = pendingApprovals.map((order) => order.tableId);
    const billTableIds = bills
      .filter((bill) => bill.status === BillStatus.BILL_REQUESTED)
      .map((bill) => bill.tableId);
    const waiterRequestTableIds = waiterRequests
      .filter((request) => request.status === 'OPEN')
      .map((request) => request.tableId);
    return new Set([...pendingTableIds, ...billTableIds, ...waiterRequestTableIds]);
  }, [bills, pendingApprovals, waiterRequests]);

  const tableOrders = selectedTable
    ? orders.filter(
        (order) =>
          order.tableId === selectedTable.id &&
          ![OrderStatus.DELIVERED, OrderStatus.CANCELLED].includes(order.status)
      )
    : [];

  const tableBills = selectedTable
    ? bills.filter((bill) => bill.tableId === selectedTable.id && bill.status !== BillStatus.PAID)
    : [];
  const selectedSessionId = selectedTable?.activeSessionId || null;
  const tableSessionOrders = selectedTable && selectedSessionId
    ? orders.filter(
        (order) =>
          order.tableId === selectedTable.id &&
          order.sessionId === selectedSessionId
      )
    : [];
  const tableSettlementOrders = tableSessionOrders.filter(
    (order) => order.status === OrderStatus.DELIVERED && !order.settledAt
  );
  const tableHasOpenWorkflow = tableSessionOrders.some((order) =>
    [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY].includes(order.status)
  );
  const tableSettlementTotal = tableSettlementOrders.reduce((sum, order) => sum + order.subtotal, 0);
  const selectedTableHistoryOrders = selectedTable && selectedSessionId
    ? orders.filter(
        (order) =>
          order.tableId === selectedTable.id &&
          order.sessionId === selectedSessionId
      )
    : [];
  const selectedTableNeedsSessionReview = Boolean(
    selectedTable &&
      selectedTable.activeSessionId &&
      selectedTable.status === TableStatus.AVAILABLE &&
      (selectedTableHistoryOrders.some((order) => hasFinishedStatus(order.status)) ||
        tableBills.some((bill) => bill.sessionId === selectedTable.activeSessionId))
  );

  const getSessionWarning = (order: Order) => {
    const relatedOrders = orders.filter(
      (entry) => entry.tableId === order.tableId && entry.sessionId === order.sessionId && entry.id !== order.id
    );
    const hasSessionHistory = relatedOrders.some((entry) => hasFinishedStatus(entry.status));
    const hasSessionBill = bills.some(
      (bill) => bill.tableId === order.tableId && bill.sessionId === order.sessionId
    );
    const table = tables.find((entry) => entry.id === order.tableId);
    const staleAvailableSession =
      table?.status === TableStatus.AVAILABLE &&
      table.activeSessionId === order.sessionId &&
      relatedOrders.length > 0;

    if (!hasSessionHistory && !hasSessionBill && !staleAvailableSession) {
      return null;
    }

    return `Masa ${order.tableNumber} are deja activitate mai veche pe aceasta sesiune. Daca este un grup nou, porneste o sesiune noua inainte sa trimiti comanda in bucatarie.`;
  };

  const isUsuallyFrontOnlyCategory = (category?: Category) => {
    if (!category) {
      return false;
    }

    const haystack = `${category.name} ${category.slug}`.toLowerCase();
    return ['baut', 'drink', 'bar', 'nargh', 'hookah', 'cafea', 'coffee', 'cocktail', 'vin', 'bere', 'suc', 'racor']
      .some((keyword) => haystack.includes(keyword));
  };

  const getDefaultKitchenSelection = (productId: string, sendToKitchen?: boolean) => {
    if (typeof sendToKitchen === 'boolean') {
      return sendToKitchen;
    }

    const product = products.find((entry) => entry.id === productId);
    const category = product ? categoryById.get(product.categoryId) : undefined;
    return !isUsuallyFrontOnlyCategory(category);
  };

  useEffect(() => {
    setManualKitchenSelections((current) => {
      const next: Record<string, boolean> = {};

      manualCart.forEach((item) => {
        next[item.id] = current[item.id] ?? getDefaultKitchenSelection(item.product.id);
      });

      const sameKeys =
        Object.keys(current).length === Object.keys(next).length &&
        Object.keys(next).every((itemId) => current[itemId] === next[itemId]);

      return sameKeys ? current : next;
    });
  }, [getDefaultKitchenSelection, manualCart]);

  useEffect(() => {
    if (!pendingApprovals.length) {
      setApprovalSelections({});
      return;
    }

    setApprovalSelections((current) => {
      const next: Record<string, Record<string, boolean>> = {};

      pendingApprovals.forEach((order) => {
        const existingOrderSelection = current[order.id] || {};
        next[order.id] = {};

        order.items.forEach((item) => {
          next[order.id][item.id] =
            existingOrderSelection[item.id] ?? getDefaultKitchenSelection(item.productId, item.sendToKitchen);
        });
      });

      return next;
    });
  }, [categoryById, pendingApprovals, products]);

  const toggleKitchenItemSelection = (orderId: string, itemId: string) => {
    setApprovalSelections((current) => ({
      ...current,
      [orderId]: {
        ...(current[orderId] || {}),
        [itemId]: !(current[orderId]?.[itemId] ?? true),
      },
    }));
  };

  const getSelectedKitchenItemIds = (order: Order) =>
    order.items
      .filter((item) => approvalSelections[order.id]?.[item.id] ?? getDefaultKitchenSelection(item.productId, item.sendToKitchen))
      .map((item) => item.id);

  const getSelectedKitchenItemCount = (order: Order) => getSelectedKitchenItemIds(order).length;
  const getKitchenItemCount = (order: Order) => order.items.filter((item) => item.sendToKitchen !== false).length;
  const getPendingApprovalActionLabel = (order: Order) =>
    getSelectedKitchenItemCount(order) === 0 ? 'Proceseaza comanda' : 'Aproba spre bucatarie';

  const getKitchenStatusMeta = (order: Order) => {
    const kitchenItemCount = getKitchenItemCount(order);

    if (kitchenItemCount === 0) {
      return {
        label: 'Fara bucatarie',
        detail: 'Comanda ramane la bar / servire, dar este salvata complet in istoric.',
        badgeClass: 'border-white/8 bg-card text-muted',
      };
    }

    if (order.status === OrderStatus.READY) {
      return {
        label: 'Gata de ridicare',
        detail: 'Bucataria a terminat. Ospatarul poate ridica si servi comanda.',
        badgeClass: 'border-success/20 bg-success/10 text-success',
      };
    }

    if ((order.status === OrderStatus.CONFIRMED || order.status === OrderStatus.PREPARING) && order.prepTimeEstimate) {
      return {
        label: 'Timp setat',
        detail: `Comanda este deja in fluxul bucatariei. Estimare actuala: ${order.prepTimeEstimate} min.`,
        badgeClass: 'border-warning/20 bg-warning/10 text-warning',
      };
    }

    if (order.status === OrderStatus.CONFIRMED) {
      return {
        label: 'Trimisa in bucatarie',
        detail: 'Comanda a fost trimisa in bucatarie si asteapta estimarea de timp.',
        badgeClass: 'border-primary/20 bg-primary/10 text-primary',
      };
    }

    if (order.status === OrderStatus.PENDING) {
      return {
        label: 'Asteapta aprobare',
        detail: 'Inca nu a fost trimisa mai departe catre bucatarie.',
        badgeClass: 'border-white/8 bg-card text-muted',
      };
    }

    return {
      label: getOrderStatusLabel(order.status),
      detail: 'Status actual al comenzii.',
      badgeClass: 'border-white/8 bg-card text-muted',
    };
  };

  const approveOrder = async (orderId: string) => {
    try {
      const targetOrder = orders.find((order) => order.id === orderId);
      if (!targetOrder) {
        return;
      }

      const warning = getSessionWarning(targetOrder);
      const startNewSession = warning
        ? window.confirm(`${warning}\n\nApasa OK pentru a porni o sesiune noua. Apasa Cancel pentru a pastra sesiunea curenta si a aproba oricum.`)
        : false;
      const selectedKitchenItemIds = getSelectedKitchenItemIds(targetOrder);

      await api.updateOrderStatus(orderId, OrderStatus.CONFIRMED, undefined, startNewSession, selectedKitchenItemIds);
      fetchAllData();
    } catch (error) {
      console.error('Nu am putut aproba comanda', error);
    }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      await api.updateOrderStatus(orderId, OrderStatus.CANCELLED);
      fetchAllData();
    } catch (error) {
      console.error('Nu am putut anula comanda', error);
    }
  };

  const deliverOrder = async (orderId: string) => {
    try {
      await api.updateOrderStatus(orderId, OrderStatus.DELIVERED);
      fetchAllData();
    } catch (error) {
      console.error('Nu am putut marca livrarea comenzii', error);
    }
  };

  const completeBill = async (billId: string) => {
    try {
      await api.updateBillStatus(billId, BillStatus.PAID);
      fetchAllData();
    } catch (error) {
      console.error('Nu am putut finaliza nota', error);
    }
  };

  const settleSelectedTable = async (paymentMethod: PaymentMethod) => {
    if (!selectedTable) {
      return;
    }

    try {
      await api.settleTableSession(selectedTable.id, paymentMethod);
      fetchAllData();
    } catch (error) {
      console.error('Nu am putut inchide sesiunea mesei', error);
      alert(error instanceof Error ? error.message : 'Nu am putut inchide sesiunea mesei.');
    }
  };

  const clearTable = async (tableId: string) => {
    try {
      await api.clearTableSession(tableId);
      setManualQueuedOrders((current) => current.filter((order) => order.tableId !== tableId));
      if (selectedTableId === tableId) {
        resetManualDraft();
        resetPendingEditor();
        setIsAddingManual(false);
      }
      fetchAllData();
    } catch (error) {
      console.error('Nu am putut goli masa', error);
    }
  };

  const resetManualDraft = () => {
    setManualCart([]);
    setManualKitchenSelections({});
    setManualNote('');
    setConfigProduct(null);
    setConfigChoices({});
    setConfigQuantity(1);
    setConfigContext(null);
    setConfigLineNotes('');
  };

  const resetPendingEditor = () => {
    setPendingEditorOrderId(null);
    setPendingEditorItems([]);
    setIsSavingPendingEditor(false);
    setConfigProduct(null);
    setConfigChoices({});
    setConfigQuantity(1);
    setConfigContext(null);
    setConfigLineNotes('');
  };

  const openProductConfigurator = (product: Product, context: ProductConfigContext) => {
    setConfigProduct(product);
    setConfigChoices({});
    setConfigQuantity(1);
    setConfigContext(context);
    setConfigLineNotes('');
  };

  const closeProductConfigurator = () => {
    setConfigProduct(null);
    setConfigChoices({});
    setConfigQuantity(1);
    setConfigContext(null);
    setConfigLineNotes('');
  };

  const upsertManualLine = (
    product: Product,
    quantity: number,
    selectedOptions: SelectedOrderOption[],
    notes?: string
  ) => {
    if (quantity <= 0) {
      return;
    }

    setManualCart((current) => {
      const signature = getSelectedOptionSignature(selectedOptions);
      const normalizedNotes = notes?.trim() || undefined;
      const existingIndex = current.findIndex(
        (item) =>
          item.product.id === product.id &&
          getSelectedOptionSignature(item.selectedOptions) === signature &&
          (item.notes?.trim() || undefined) === normalizedNotes
      );

      if (existingIndex >= 0) {
        return current.map((item, index) =>
          index === existingIndex
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }

      return [
        ...current,
        {
          id: createManualLineId(),
          product,
          quantity,
          notes: normalizedNotes,
          selectedOptions,
        },
      ];
    });
  };

  const upsertPendingEditorLine = (
    product: Product,
    quantity: number,
    selectedOptions: SelectedOrderOption[],
    notes?: string
  ) => {
    if (quantity <= 0) {
      return;
    }

    setPendingEditorItems((current) => {
      const signature = getSelectedOptionSignature(selectedOptions);
      const normalizedNotes = notes?.trim() || undefined;
      const existingIndex = current.findIndex(
        (item) =>
          item.product.id === product.id &&
          getSelectedOptionSignature(item.selectedOptions) === signature &&
          (item.notes?.trim() || undefined) === normalizedNotes
      );

      if (existingIndex >= 0) {
        return current.map((item, index) =>
          index === existingIndex
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }

      return [
        ...current,
        {
          id: createManualLineId(),
          product,
          quantity,
          notes: normalizedNotes,
          selectedOptions,
        },
      ];
    });
  };

  const modifyManualQty = (product: Product, delta: number) => {
    if (delta > 0) {
      openProductConfigurator(product, 'manual');
      return;
    }

    if (product.optionGroups?.length) {
      setManualCart((current) => {
        const nextCart = [...current];
        for (let index = nextCart.length - 1; index >= 0; index -= 1) {
          if (nextCart[index].product.id !== product.id) {
            continue;
          }

          const target = nextCart[index];
          if (target.quantity <= 1) {
            nextCart.splice(index, 1);
          } else {
            nextCart[index] = { ...target, quantity: target.quantity - 1 };
          }
          break;
        }
        return nextCart;
      });
      return;
    }

    setManualCart((current) =>
      current
        .map((item) => {
          if (item.product.id !== product.id || item.selectedOptions.length > 0) {
            return item;
          }

          const nextQuantity = item.quantity + delta;
          return nextQuantity > 0 ? { ...item, quantity: nextQuantity } : null;
        })
        .filter(Boolean) as ManualDraftItem[]
    );
  };

  const modifyPendingEditorQty = (product: Product, delta: number) => {
    if (delta > 0) {
      openProductConfigurator(product, 'pending');
      return;
    }

    if (product.optionGroups?.length) {
      setPendingEditorItems((current) => {
        const nextItems = [...current];
        for (let index = nextItems.length - 1; index >= 0; index -= 1) {
          if (nextItems[index].product.id !== product.id) {
            continue;
          }

          const target = nextItems[index];
          if (target.quantity <= 1) {
            nextItems.splice(index, 1);
          } else {
            nextItems[index] = { ...target, quantity: target.quantity - 1 };
          }
          break;
        }
        return nextItems;
      });
      return;
    }

    setPendingEditorItems((current) =>
      current
        .map((item) => {
          if (item.product.id !== product.id || item.selectedOptions.length > 0) {
            return item;
          }

          const nextQuantity = item.quantity + delta;
          return nextQuantity > 0 ? { ...item, quantity: nextQuantity } : null;
        })
        .filter(Boolean) as ManualDraftItem[]
    );
  };

  const modifyManualLineQuantity = (lineId: string, delta: number) => {
    setManualCart((current) =>
      current
        .map((item) => {
          if (item.id !== lineId) {
            return item;
          }

          const nextQuantity = item.quantity + delta;
          return nextQuantity > 0 ? { ...item, quantity: nextQuantity } : null;
        })
        .filter(Boolean) as ManualDraftItem[]
    );
  };

  const modifyPendingEditorLineQuantity = (lineId: string, delta: number) => {
    setPendingEditorItems((current) =>
      current
        .map((item) => {
          if (item.id !== lineId) {
            return item;
          }

          const nextQuantity = item.quantity + delta;
          return nextQuantity > 0 ? { ...item, quantity: nextQuantity } : null;
        })
        .filter(Boolean) as ManualDraftItem[]
    );
  };

  const updateManualLineNotes = (lineId: string, notes: string) => {
    setManualCart((current) =>
      current.map((item) =>
        item.id === lineId
          ? {
              ...item,
              notes: notes.trim() ? notes : '',
            }
          : item
      )
    );
  };

  const updatePendingEditorLineNotes = (lineId: string, notes: string) => {
    setPendingEditorItems((current) =>
      current.map((item) =>
        item.id === lineId
          ? {
              ...item,
              notes: notes.trim() ? notes : '',
            }
          : item
      )
    );
  };

  const toggleManualKitchenSelection = (itemId: string) => {
    const targetItem = manualCart.find((item) => item.id === itemId);
    setManualKitchenSelections((current) => ({
      ...current,
      [itemId]: !(current[itemId] ?? getDefaultKitchenSelection(targetItem?.product.id || '')),
    }));
  };

  const toggleConfigChoice = (group: ProductOptionGroup, choiceId: string) => {
    setConfigChoices((current) => {
      const existing = current[group.id] || [];
      const alreadySelected = existing.includes(choiceId);

      if (group.selectionType === 'single') {
        return {
          ...current,
          [group.id]: alreadySelected ? [] : [choiceId],
        };
      }

      if (alreadySelected) {
        return {
          ...current,
          [group.id]: existing.filter((entry) => entry !== choiceId),
        };
      }

      const maxSelections = group.maxSelections && group.maxSelections > 0 ? group.maxSelections : undefined;
      const preservedExisting = maxSelections
        ? maxSelections > 1
          ? existing.slice(-(maxSelections - 1))
          : []
        : existing;

      return {
        ...current,
        [group.id]: maxSelections ? [...preservedExisting, choiceId] : [...existing, choiceId],
      };
    });
  };

  const configSelectedOptions = configProduct ? buildSelectedOptions(configProduct, configChoices) : [];
  const configUnitPrice = configProduct ? getManualLineUnitPrice(configProduct, configSelectedOptions) : 0;

  const addConfiguredProduct = () => {
    if (!configProduct || !configContext) {
      return;
    }

    const missingRequiredGroup = (configProduct.optionGroups || []).find(
      (group) => group.required && !configSelectedOptions.some((option) => option.groupId === group.id)
    );

    if (missingRequiredGroup) {
      alert(`Selecteaza o optiune pentru "${missingRequiredGroup.name}".`);
      return;
    }

    if (configContext === 'manual') {
      upsertManualLine(configProduct, configQuantity, configSelectedOptions, configLineNotes);
    } else {
      upsertPendingEditorLine(configProduct, configQuantity, configSelectedOptions, configLineNotes);
    }

    closeProductConfigurator();
  };

  const manualReviewItems = useMemo(
    () =>
      manualCart.map((item) => ({
        id: item.id,
        productId: item.product.id,
        productName: item.product.name,
        price: getManualLineUnitPrice(item.product, item.selectedOptions),
        quantity: item.quantity,
        notes: item.notes?.trim() || undefined,
        sendToKitchen: manualKitchenSelections[item.id] ?? getDefaultKitchenSelection(item.product.id),
        selectedOptions: item.selectedOptions,
      })),
    [getDefaultKitchenSelection, manualCart, manualKitchenSelections]
  );

  const manualKitchenItemCount = useMemo(
    () => manualReviewItems.filter((item) => item.sendToKitchen).reduce((sum, item) => sum + item.quantity, 0),
    [manualReviewItems]
  );

  const queueManualOrder = () => {
    if (!selectedTable) {
      return;
    }

    if (manualReviewItems.length === 0) {
      alert('Adauga mai intai cel putin un produs.');
      return;
    }

      const queuedOrder: ManualQueuedOrder = {
      id: `manual-queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tableId: selectedTable.id,
      tableNumber: selectedTable.number,
      tableLabel: getTableDisplayLabel(selectedTable),
      items: manualReviewItems.map((item) => ({ ...item })),
      notes: manualNote.trim(),
      subtotal: Number(
        manualReviewItems.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)
      ),
      createdAt: new Date().toISOString(),
    };

    setManualQueuedOrders((current) => [...current, queuedOrder]);
    pushAlert({
      tableId: selectedTable.id,
      title: `${queuedOrder.tableLabel} a fost adaugata in coada`,
      detail: `${queuedOrder.items.reduce((sum, item) => sum + item.quantity, 0)} produse pregatite pentru trimiterea comuna.`,
      tone: 'order',
    });
    resetManualDraft();
    setIsAddingManual(false);
  };

  const removeQueuedManualOrder = (queueId: string) => {
    setManualQueuedOrders((current) => current.filter((order) => order.id !== queueId));
  };

  const submitManualQueue = async () => {
    if (!manualQueuedOrders.length) {
      return;
    }

    setIsSendingManualQueue(true);

    try {
      const results = await Promise.allSettled(
        manualQueuedOrders.map((queuedOrder) =>
          api.createOrder(
            queuedOrder.tableId,
            queuedOrder.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              price: item.price,
              quantity: item.quantity,
              notes: item.notes,
              sendToKitchen: item.sendToKitchen,
              selectedOptions: item.selectedOptions,
            })),
            queuedOrder.notes,
            OrderSource.WAITER
          )
        )
      );

      const failedOrderIds = new Set(
        results.flatMap((result, index) => (result.status === 'rejected' ? [manualQueuedOrders[index].id] : []))
      );

      if (failedOrderIds.size > 0) {
        setManualQueuedOrders((current) => current.filter((order) => failedOrderIds.has(order.id)));
        alert('Unele comenzi nu au putut fi trimise. Le-am pastrat in coada ca sa le poti retrimite.');
      } else {
        setManualQueuedOrders([]);
      }

      fetchAllData();
    } catch (error) {
      console.error('Nu am putut trimite coada manuala catre bucatarie', error);
    } finally {
      setIsSendingManualQueue(false);
    }
  };

  const openPendingOrderEditor = (orderId: string) => {
    setPendingEditorOrderId(orderId);
    setPendingEditorItems([]);
    setIsSavingPendingEditor(false);
  };

  const savePendingOrderAdditions = async () => {
    if (!pendingEditorOrderId || pendingEditorItems.length === 0) {
      return;
    }

    setIsSavingPendingEditor(true);
    try {
      await api.appendItemsToPendingOrder(
        pendingEditorOrderId,
        pendingEditorItems.map((item) => ({
          productId: item.product.id,
          productName: item.product.name,
          price: getManualLineUnitPrice(item.product, item.selectedOptions),
          quantity: item.quantity,
          notes: item.notes?.trim() || undefined,
          selectedOptions: item.selectedOptions,
        }))
      );
      await fetchAllData();
      resetPendingEditor();
    } catch (error) {
      console.error('Nu am putut completa comanda clientului', error);
      alert(error instanceof Error ? error.message : 'Nu am putut completa comanda clientului.');
      setIsSavingPendingEditor(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-white px-4 py-5 md:px-6">
      <div className="max-w-7xl mx-auto flex flex-col gap-6">
        {alerts.length > 0 && (
          <div className="flex flex-col gap-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-[24px] border px-4 py-3 flex items-start gap-3 shadow-lg ${
                  alert.tone === 'bill'
                    ? 'border-danger/30 bg-danger/15'
                    : 'border-primary/30 bg-primary/15'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                    alert.tone === 'bill'
                      ? 'bg-danger/20 text-danger'
                      : alert.tone === 'call'
                        ? 'bg-warning/20 text-warning'
                        : 'bg-primary/20 text-primary'
                  }`}
                >
                  <BellRing className="w-5 h-5 animate-pulse" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{alert.title}</p>
                  <p className="text-xs text-muted mt-1">{alert.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-card border border-white/8 flex items-center justify-center">
              <ClipboardList className="w-6 h-6 text-success" />
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.35em] text-success">Asistent ospatar</p>
              <h1 className="mt-2 text-3xl font-display font-bold">Aproba cererile meselor inainte de bucatarie</h1>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/8 bg-card px-4 py-3 text-sm text-muted">
              Aprobari in asteptare: <span className="text-white font-semibold">{pendingApprovals.length}</span>
            </div>
            <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-white">
              Coada manuala: <span className="font-semibold">{manualQueuedOrders.length}</span>
              <span className="ml-2 text-white/70">({manualQueueItemCount} produse)</span>
            </div>
            <button
              onClick={testWaiterAlertSound}
              title={isWaiterAlertLoopActive ? 'Opreste sunetul ospatarului' : 'Testeaza sunetul ospatarului'}
              aria-label={isWaiterAlertLoopActive ? 'Opreste sunetul ospatarului' : 'Testeaza sunetul ospatarului'}
              className={`flex h-[52px] w-full items-center justify-center rounded-2xl transition ${
                isWaiterAlertLoopActive
                  ? 'border border-warning/30 bg-warning/15 text-warning shadow-[0_0_0_1px_rgba(212,162,67,0.16)]'
                  : 'border border-white/8 bg-card text-white hover:border-white/15'
              }`}
            >
              {isWaiterAlertLoopActive ? (
                <BellRing className="waiter-sound-vibrate h-6 w-6" />
              ) : (
                <BellOff className="h-6 w-6" />
              )}
            </button>
            <button
              onClick={() => void onLogout?.()}
              className="rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm font-semibold text-white transition hover:border-white/15"
            >
              Iesi din sesiune
            </button>
          </div>
        </header>

        <section className="rounded-[28px] border border-primary/20 bg-card p-5">
          <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-3">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.3em] text-primary">Coada de aprobare</p>
              <h2 className="mt-2 text-xl font-display font-bold">Comenzi de la clienti care asteapta aprobarea ospatarului</h2>
            </div>
            <span className="text-xs font-mono uppercase text-muted">{pendingApprovals.length} in asteptare</span>
          </div>

          {pendingApprovals.length === 0 ? (
            <div className="py-12 text-center text-muted text-sm">Nu exista cereri de la clienti in asteptare acum.</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
              {pendingApprovals.map((order) => (
                <div key={order.id} className="rounded-[24px] border border-white/8 bg-background/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono uppercase tracking-[0.25em] text-muted">Masa {order.tableNumber}</p>
                      <h3 className="mt-2 text-lg font-display font-bold">{order.orderNumber}</h3>
                      <p className="mt-1 text-xs text-muted">
                        {order.items.length} items • {formatCad(order.subtotal)}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono uppercase text-primary">Asteapta aprobare</span>
                  </div>

                  {getSessionWarning(order) && (
                    <div className="mt-4 rounded-2xl border border-warning/20 bg-warning/10 px-3 py-3 text-xs text-warning">
                      Este posibil ca sesiunea anterioara sa fie inca deschisa la aceasta masa. Aprobarea poate porni o sesiune noua daca este nevoie.
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {order.items.map((item) => (
                      <label
                        key={item.id}
                        className={`flex items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-sm cursor-pointer ${
                          approvalSelections[order.id]?.[item.id] ?? getDefaultKitchenSelection(item.productId, item.sendToKitchen)
                            ? 'border-primary/20 bg-primary/10'
                            : 'border-white/8 bg-card/50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-semibold">{item.productName}</p>
                          {groupSelectedOptions(item.selectedOptions).length > 0 && (
                            <div className="mt-1 space-y-1">
                              {groupSelectedOptions(item.selectedOptions).map((group) => (
                                <p key={`${item.id}-${group.groupId}`} className="text-[11px] text-muted">
                                  {group.groupName}: {group.choices.map((choice) => choice.choiceName).join(', ')}
                                </p>
                              ))}
                            </div>
                          )}
                          {item.notes && <p className="text-xs text-primary mt-1">{item.notes}</p>}
                          <p className="mt-1 text-[11px] text-muted">
                            {approvalSelections[order.id]?.[item.id] ?? getDefaultKitchenSelection(item.productId, item.sendToKitchen)
                              ? 'Merge in bucatarie'
                              : 'Ramane doar pentru servire / bar'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-muted font-mono">x{item.quantity}</span>
                          <input
                            type="checkbox"
                            checked={approvalSelections[order.id]?.[item.id] ?? getDefaultKitchenSelection(item.productId, item.sendToKitchen)}
                            onChange={() => toggleKitchenItemSelection(order.id, item.id)}
                            className="h-4 w-4 accent-primary"
                          />
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/8 bg-card px-3 py-3 text-xs text-muted">
                    {getSelectedKitchenItemCount(order) === 0
                      ? 'Nu ai nimic trimis in bucatarie. Comanda va ramane doar pentru servire / bar, dar se salveaza complet in istoric.'
                      : `Selectate pentru bucatarie: ${getSelectedKitchenItemCount(order)} / ${order.items.length}. Ce debifezi ramane pe comanda, dar nu ajunge in panoul bucatariei.`}
                  </div>

                  {order.notes && (
                    <div className="mt-4 rounded-2xl border border-white/8 bg-card px-3 py-3 text-xs text-muted">
                      {order.notes}
                    </div>
                  )}

                  <button
                    onClick={() => openPendingOrderEditor(order.id)}
                    className="mt-4 w-full rounded-2xl border border-white/8 bg-card px-4 py-3 text-sm font-semibold text-white"
                  >
                    Adauga produse inainte de confirmare
                  </button>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => cancelOrder(order.id)}
                      className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger"
                    >
                      Respinge
                    </button>
                    <button
                      onClick={() => approveOrder(order.id)}
                      className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold"
                    >
                      {getPendingApprovalActionLabel(order)}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-white/8 bg-card p-5">
          <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-3">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.3em] text-muted">Gata de servire</p>
              <h2 className="mt-2 text-xl font-display font-bold">Comenzi din bucatarie care asteapta livrarea</h2>
            </div>
            <span className="text-xs font-mono uppercase text-success">{readyForDelivery.length} gata</span>
          </div>

          {readyForDelivery.length === 0 ? (
            <div className="py-10 text-center text-muted text-sm">Nu exista preparate care asteapta ridicarea.</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {readyForDelivery.map((order) => (
                <div key={order.id} className="rounded-[24px] border border-success/20 bg-success/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono uppercase tracking-[0.25em] text-success">Masa {order.tableNumber}</p>
                      <h3 className="mt-2 text-lg font-display font-bold">{order.orderNumber}</h3>
                    </div>
                    <button
                      onClick={() => deliverOrder(order.id)}
                      className="rounded-2xl bg-success px-4 py-2 text-sm font-semibold text-black"
                    >
                      Livrata
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-primary/20 bg-card p-5">
          <div className="flex flex-col gap-4 border-b border-white/5 pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.3em] text-primary">Coada manuala</p>
              <h2 className="mt-2 text-xl font-display font-bold">Comenzi pregatite de ospatar pentru trimitere comuna</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm text-muted">
                {manualQueuedOrders.length} comenzi • {manualQueueItemCount} produse • {formatCad(manualQueueTotal)}
              </div>
              <button
                onClick={submitManualQueue}
                disabled={!manualQueuedOrders.length || isSendingManualQueue}
                className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSendingManualQueue ? 'Se trimite...' : 'Trimite toata coada in bucatarie'}
              </button>
            </div>
          </div>

          {manualQueuedOrders.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              Nu exista comenzi manuale in coada. Adauga produse pe o masa, revizuieste-le si pune-le aici.
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              {manualQueuedOrders.map((queuedOrder) => (
                <div key={queuedOrder.id} className="rounded-[24px] border border-white/8 bg-background/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono uppercase tracking-[0.24em] text-primary">{queuedOrder.tableLabel}</p>
                      <h3 className="mt-2 text-lg font-display font-bold">{formatCad(queuedOrder.subtotal)}</h3>
                      <p className="mt-1 text-xs text-muted">
                        {queuedOrder.items.reduce((sum, item) => sum + item.quantity, 0)} produse •{' '}
                        {queuedOrder.items.filter((item) => item.sendToKitchen).reduce((sum, item) => sum + item.quantity, 0)} merg in bucatarie
                      </p>
                    </div>
                    <button
                      onClick={() => removeQueuedManualOrder(queuedOrder.id)}
                      className="rounded-2xl border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger"
                    >
                      Scoate
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {queuedOrder.items.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-2xl border px-3 py-3 text-sm ${
                          item.sendToKitchen ? 'border-primary/20 bg-primary/10' : 'border-white/8 bg-card/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold">{item.productName}</p>
                            {groupSelectedOptions(item.selectedOptions).length > 0 && (
                              <div className="mt-1 space-y-1">
                                {groupSelectedOptions(item.selectedOptions).map((group) => (
                                  <p key={`${item.id}-${group.groupId}`} className="text-[11px] text-muted">
                                    {group.groupName}: {group.choices.map((choice) => choice.choiceName).join(', ')}
                                  </p>
                                ))}
                              </div>
                            )}
                            {item.notes ? <p className="mt-2 text-[11px] text-primary">Nota: {item.notes}</p> : null}
                            <p className="mt-1 text-[11px] text-muted">
                              {item.sendToKitchen ? 'Merge in bucatarie' : 'Ramane doar in istoric / servire'}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-muted">x{item.quantity}</p>
                            <p className="mt-1 text-xs text-white/70">{formatCad(item.price * item.quantity)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {queuedOrder.notes && (
                    <div className="mt-4 rounded-2xl border border-white/8 bg-card px-3 py-3 text-xs text-muted">
                      {queuedOrder.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={`grid grid-cols-1 gap-6 items-start ${isAddingManual ? 'xl:grid-cols-1' : 'xl:grid-cols-[1.5fr_1fr]'}`}>
          <div className={`rounded-[28px] border border-white/8 bg-card p-5 ${isAddingManual ? 'xl:order-2' : ''}`}>
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.3em] text-muted">Harta salii</p>
                <h2 className="mt-2 text-xl font-display font-bold">Selecteaza masa</h2>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {tables.map((table) => {
                const isSelected = selectedTable?.id === table.id;
                const hasAttention = attentionTableIds.has(table.id);
                const isHighlighted = Boolean(highlightedTables[table.id]);
                const palette =
                  table.status === TableStatus.NEEDS_BILL
                    ? 'border-danger/30 bg-danger/10 text-danger'
                    : table.status === TableStatus.READY
                      ? 'border-success/30 bg-success/10 text-success'
                      : table.status === TableStatus.PREPARING
                        ? 'border-warning/30 bg-warning/10 text-warning'
                        : table.status === TableStatus.WAITING
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-white/8 bg-background text-white';

                return (
                  <button
                    key={table.id}
                    onClick={() => {
                      setSelectedTableId(table.id);
                      setIsAddingManual(false);
                      resetManualDraft();
                      void resolveWaiterRequestsForTable(table.id);
                    }}
                    className={`rounded-[24px] border p-4 text-left transition-all ${palette} ${
                      isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
                    } ${isHighlighted ? 'waiter-attention' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                        <p className="text-lg font-display font-bold leading-6">{getTableDisplayLabel(table)}</p>
                      {hasAttention && (
                        <div className="relative mt-1 shrink-0">
                          <span
                            className={`block w-3 h-3 rounded-full ${
                              table.status === TableStatus.NEEDS_BILL
                                ? 'bg-danger'
                                : waiterRequests.some((request) => request.tableId === table.id && request.status === 'OPEN')
                                  ? 'bg-warning'
                                  : 'bg-primary'
                            }`}
                          />
                          <span
                            className={`absolute inset-0 rounded-full animate-ping ${
                              table.status === TableStatus.NEEDS_BILL
                                ? 'bg-danger'
                                : waiterRequests.some((request) => request.tableId === table.id && request.status === 'OPEN')
                                  ? 'bg-warning'
                                  : 'bg-primary'
                            }`}
                          />
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] font-mono uppercase">{getTableStatusLabel(table.status)}</p>
                    <p className="mt-1 text-[10px] font-mono uppercase text-primary">{getTableAreaLabel(table.area)}</p>
                    <p className="mt-4 text-[11px] text-muted">
                      {table.activeSessionId
                        ? table.status === TableStatus.AVAILABLE
                          ? 'Sesiunea anterioara nu este inchisa'
                          : 'Sesiune activa'
                        : 'Nicio sesiune deschisa'}
                    </p>
                    {table.status === TableStatus.NEEDS_BILL && (
                      <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.2em] text-danger">
                        Nota ceruta
                      </p>
                    )}
                    {table.status === TableStatus.AVAILABLE && table.activeSessionId && (
                      <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.2em] text-warning">
                        Verifica sesiunea
                      </p>
                    )}
                    {table.status === TableStatus.WAITING && pendingApprovals.some((order) => order.tableId === table.id) && (
                      <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.2em] text-primary">
                        Asteapta aprobare
                      </p>
                    )}
                    {waiterRequests.some((request) => request.tableId === table.id && request.status === 'OPEN') && (
                      <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.2em] text-warning">
                        Ospatar chemat
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`rounded-[28px] border border-white/8 bg-card p-5 ${isAddingManual ? 'xl:order-1' : ''}`}>
            {selectedTable ? (
              <div className="flex flex-col gap-5">
                <div className="border-b border-white/5 pb-3">
                  <p className="text-xs font-mono uppercase tracking-[0.3em] text-muted">Masa selectata</p>
                  <h2 className="mt-2 text-2xl font-display font-bold">{getTableDisplayLabel(selectedTable)}</h2>
                  <p className="mt-1 text-[11px] font-mono uppercase text-primary">{getTableAreaLabel(selectedTable.area)}</p>
                  <p className="mt-1 text-sm text-muted">Status curent: {getTableStatusLabel(selectedTable.status)}</p>
                </div>

                {selectedTableNeedsSessionReview && (
                  <div className="rounded-[24px] border border-warning/20 bg-warning/10 p-4">
                    <p className="text-sm font-semibold text-warning">Sesiunea anterioara poate fi inca deschisa</p>
                    <p className="mt-2 text-xs text-white/80 leading-6">
                      Aceasta masa are inca istoric pe sesiunea curenta, desi masa pare disponibila. Daca se aseaza un
                      grup nou aici, aproba prima cerere ca sesiune noua sau goleste masa mai intai.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => clearTable(selectedTable.id)}
                    className="rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Goleste sesiunea
                  </button>
                  <button
                    onClick={() =>
                      setIsAddingManual((current) => {
                        const nextValue = !current;
                        if (!nextValue) {
                          closeProductConfigurator();
                        }
                        return nextValue;
                      })
                    }
                    className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    Comanda manuala
                  </button>
                </div>

                {tableBills.length > 0 && (
                  <div className="rounded-[24px] border border-danger/20 bg-danger/10 p-4">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-danger" />
                      <h3 className="text-sm font-display font-bold text-danger">Cereri de nota deschise</h3>
                    </div>
                    <div className="mt-3 space-y-3">
                      {tableBills.map((bill) => (
                        <div key={bill.id} className="rounded-2xl border border-white/8 bg-background/60 p-3">
                          <p className="text-sm font-semibold">{formatCad(bill.subtotal)}</p>
                          <p className="mt-1 text-xs text-muted">Metoda de plata: {getPaymentMethodLabel(bill.paymentMethod || 'CASH')}</p>
                          <button
                            onClick={() => completeBill(bill.id)}
                            className="mt-3 w-full rounded-2xl bg-danger px-4 py-3 text-sm font-semibold"
                          >
                            Confirma plata
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!tableHasOpenWorkflow && tableSettlementOrders.length > 0 && (
                  <div className="rounded-[24px] border border-success/20 bg-success/10 p-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-success" />
                      <h3 className="text-sm font-display font-bold text-success">Inchide masa si elibereaza sesiunea</h3>
                    </div>
                    <p className="mt-2 text-xs leading-6 text-white/80">
                      Bucataria si servirea sunt finalizate. Alege cum inchizi aceasta sesiune, iar masa va deveni din nou disponibila.
                    </p>

                    <div className="mt-3 rounded-2xl border border-white/8 bg-background/60 px-3 py-3 text-sm text-white">
                      {tableSettlementOrders.length} comenzi livrate • {formatCad(tableSettlementTotal)}
                    </div>

                    <div className="mt-3 space-y-2">
                      {tableSettlementOrders.map((order) => (
                        <div key={order.id} className="rounded-2xl border border-white/8 bg-background/60 px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-mono uppercase tracking-[0.2em] text-success">{order.orderNumber}</p>
                              <p className="mt-1 text-sm font-semibold text-white">{formatCad(order.subtotal)}</p>
                            </div>
                            <p className="text-xs text-muted">{order.items.reduce((sum, item) => sum + item.quantity, 0)} produse</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <button
                        onClick={() => settleSelectedTable('CASH')}
                        className="rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm font-semibold text-white"
                      >
                        Incasat cash
                      </button>
                      <button
                        onClick={() => settleSelectedTable('CARD')}
                        className="rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm font-semibold text-white"
                      >
                        Incasat card
                      </button>
                      <button
                        onClick={() => settleSelectedTable('PROTOCOL')}
                        className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
                      >
                        Protocol
                      </button>
                    </div>
                  </div>
                )}

                {isAddingManual ? (
                  <div className="rounded-[24px] border border-white/8 bg-background/60 p-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                      <div>
                        <h3 className="text-sm font-display font-bold">Comanda manuala ospatar</h3>
                        <p className="mt-1 text-xs text-muted">
                          Apasa pe produse, seteaza cantitatea, optiunile si nota fiecarui produs, apoi revizuieste toata comanda. Bauturile raman implicit in servire, nu in bucatarie.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 xl:min-w-[270px]">
                        <div className="rounded-2xl border border-white/8 bg-card px-4 py-3">
                          <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted">Produse</p>
                          <p className="mt-2 text-2xl font-display font-bold">{manualCartItemCount}</p>
                        </div>
                        <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3">
                          <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-primary">Total</p>
                          <p className="mt-2 text-2xl font-display font-bold text-white">{formatCad(manualCartTotal)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="pr-1 md:max-h-[58vh] md:overflow-y-auto">
                        <div className="space-y-5">
                          {manualProductGroups.map((group) => (
                            <section key={group.id}>
                              <div className="mb-3 flex items-center gap-2 px-1">
                                {group.icon ? (
                                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/8 bg-card text-lg">
                                    {group.icon}
                                  </span>
                                ) : null}
                                <div>
                                  <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary">Sectiune</p>
                                  <p className="text-sm font-display font-bold text-white md:text-base">{group.name}</p>
                                </div>
                              </div>
                              <div className="-mx-1 flex w-full flex-nowrap snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-2 overscroll-x-contain">
                                {group.products.map((product) => {
                                  const count = manualProductQuantities.get(product.id) || 0;
                                  const hasOptions = Boolean(product.optionGroups?.length);

                                  return (
                                    <div
                                      key={product.id}
                                      className={`relative w-[calc(50%-0.375rem)] min-w-[calc(50%-0.375rem)] max-w-[calc(50%-0.375rem)] shrink-0 snap-start overflow-hidden rounded-[20px] border bg-card transition-all md:w-[170px] md:min-w-[170px] md:max-w-[170px] xl:w-[188px] xl:min-w-[188px] xl:max-w-[188px] ${
                                        count > 0 ? 'border-primary/40 shadow-[0_0_0_1px_rgba(232,122,65,0.3)]' : 'border-white/8'
                                      }`}
                                    >
                                      <div className="relative aspect-[1.08]">
                                        <img
                                          src={product.imageUrl}
                                          alt={product.name}
                                          className="h-full w-full object-cover"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />

                                        <button
                                          type="button"
                                          onClick={() => modifyManualQty(product, -1)}
                                          aria-label={`Scoate ${product.name}`}
                                          className="absolute inset-y-0 left-0 z-10 flex w-1/2 items-start justify-start p-2 text-white/80 transition hover:bg-danger/20 active:bg-danger/30 disabled:cursor-not-allowed disabled:opacity-35"
                                          disabled={count === 0}
                                        >
                                          <span className="rounded-2xl bg-black/55 p-2">
                                            <Minus className="h-4 w-4" />
                                          </span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => modifyManualQty(product, 1)}
                                          aria-label={`Adauga ${product.name}`}
                                          className="absolute inset-y-0 right-0 z-10 flex w-1/2 items-start justify-end p-2 text-white transition hover:bg-success/20 active:bg-success/30"
                                        >
                                          <span className="rounded-2xl bg-primary p-2 shadow-lg">
                                            <Plus className="h-4 w-4" />
                                          </span>
                                        </button>

                                        <div className="absolute bottom-2 left-2 z-10">
                                          <span
                                            className={`rounded-full px-2.5 py-1 text-[11px] font-mono shadow-lg ${
                                              count > 0 ? 'bg-primary text-white' : 'bg-black/55 text-white/80'
                                            }`}
                                          >
                                            {count > 0 ? `x${count}` : '0'}
                                          </span>
                                        </div>
                                        {hasOptions && (
                                          <div className="absolute bottom-2 right-2 z-10 lg:bottom-2.5 lg:right-2.5">
                                            <span className="rounded-full bg-black/55 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-white/80">
                                              Optiuni
                                            </span>
                                          </div>
                                        )}
                                        {!hasOptions && (
                                          <div className="absolute bottom-2 right-2 z-10 lg:bottom-2.5 lg:right-2.5">
                                            <span className="rounded-full bg-black/55 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-white/80">
                                              Nota
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                      <div className="space-y-2 px-2.5 py-2.5">
                                        <p className="min-h-[2.5rem] text-[13px] font-display font-bold leading-5 text-white">
                                          {product.name}
                                        </p>
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-primary">
                                            {formatCad(product.price)}
                                          </p>
                                          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-white/50">
                                            {hasOptions ? 'Extra' : 'Nota'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 space-y-3 rounded-[24px] border border-white/8 bg-background/95 p-3">
                      <div className="rounded-2xl border border-white/8 bg-card p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-mono uppercase tracking-[0.24em] text-primary">Revizuire</p>
                            <h4 className="mt-2 text-base font-display font-bold">Verifica intreaga comanda inainte de coada</h4>
                          </div>
                          <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-mono text-primary">
                            {manualReviewItems.length} pozitii
                          </span>
                        </div>

                        {manualReviewItems.length === 0 ? (
                          <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-muted">
                            Nu ai produse in draftul acestei mese.
                          </div>
                        ) : (
                          <div className="mt-4 space-y-2">
                            {manualReviewItems.map((item) => (
                              <div
                                key={item.id}
                                className={`rounded-2xl border px-3 py-3 text-sm ${
                                  item.sendToKitchen ? 'border-primary/20 bg-primary/10' : 'border-white/8 bg-background/70'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="font-semibold">{item.productName}</p>
                                    {groupSelectedOptions(item.selectedOptions).length > 0 && (
                                      <div className="mt-1 space-y-1">
                                        {groupSelectedOptions(item.selectedOptions).map((group) => (
                                          <p key={`${item.id}-${group.groupId}`} className="text-[11px] text-muted">
                                            {group.groupName}: {group.choices.map((choice) => choice.choiceName).join(', ')}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                    <p className="mt-1 text-[11px] text-muted">
                                      {item.sendToKitchen ? 'Merge in bucatarie' : 'Ramane doar pentru servire / bauturi'}
                                    </p>
                                    <p className="mt-1 text-[11px] text-white/60">{formatCad(item.price * item.quantity)}</p>
                                    {item.notes ? <p className="mt-2 text-[11px] text-primary">Nota: {item.notes}</p> : null}
                                  </div>
                                  <div className="flex shrink-0 items-start gap-3">
                                    <div className="flex items-center overflow-hidden rounded-2xl border border-white/8 bg-black/20">
                                      <button
                                        type="button"
                                        onClick={() => modifyManualLineQuantity(item.id, -1)}
                                        className="px-3 py-2 text-danger transition hover:bg-danger/15 active:bg-danger/20"
                                        aria-label={`Scade ${item.productName}`}
                                      >
                                        <Minus className="h-4 w-4" />
                                      </button>
                                      <span className="min-w-[44px] px-2 text-center font-mono text-muted">x{item.quantity}</span>
                                      <button
                                        type="button"
                                        onClick={() => modifyManualLineQuantity(item.id, 1)}
                                        className="px-3 py-2 text-success transition hover:bg-success/15 active:bg-success/20"
                                        aria-label={`Creste ${item.productName}`}
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                    </div>
                                    <input
                                      type="checkbox"
                                      checked={item.sendToKitchen}
                                      onChange={() => toggleManualKitchenSelection(item.id)}
                                      className="mt-2 h-4 w-4 accent-primary"
                                    />
                                  </div>
                                </div>
                                <textarea
                                  value={item.notes || ''}
                                  onChange={(event) => updateManualLineNotes(item.id, event.target.value)}
                                  placeholder="Nota pentru acest produs..."
                                  rows={2}
                                  className="mt-3 w-full rounded-2xl border border-white/8 bg-card p-3 text-xs text-white outline-none"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-card px-3 py-3 text-xs text-muted">
                        Selectate pentru bucatarie: {manualKitchenItemCount} / {manualCartItemCount}. Ce debifezi ramane pe comanda si in istoric, dar nu ajunge in panoul bucatariei.
                      </div>

                      <textarea
                        value={manualNote}
                        onChange={(event) => setManualNote(event.target.value)}
                        placeholder="Nota suplimentara pentru bucatarie..."
                        rows={3}
                        className="w-full rounded-2xl border border-white/8 bg-card p-3 text-sm text-white outline-none"
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            resetManualDraft();
                            setIsAddingManual(false);
                          }}
                          className="flex-1 rounded-2xl border border-white/8 px-4 py-3 text-sm text-muted"
                        >
                          Anuleaza
                        </button>
                        <button
                          onClick={queueManualOrder}
                          className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold"
                        >
                          Adauga in coada
                        </button>
                      </div>
                    </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-display font-bold">Comenzi active la aceasta masa</h3>
                    {tableOrders.length === 0 ? (
                      <div className="rounded-2xl border border-white/8 bg-background/60 px-4 py-8 text-center text-sm text-muted">
                        Nu exista comenzi active la aceasta masa acum.
                      </div>
                      ) : (
                        tableOrders.map((order) => (
                          <div key={order.id} className="rounded-[24px] border border-white/8 bg-background/60 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-mono uppercase tracking-[0.25em] text-muted">{order.orderNumber}</p>
                                <h4 className="mt-2 text-lg font-display font-bold">{getOrderStatusLabel(order.status)}</h4>
                              </div>
                              <span className="text-xs font-mono uppercase text-primary">{getOrderSourceLabel(order.source)}</span>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1.1fr_0.9fr]">
                              <div className={`rounded-2xl border px-3 py-3 ${getKitchenStatusMeta(order).badgeClass}`}>
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-[10px] font-mono uppercase tracking-[0.22em]">Status bucatarie</p>
                                    <p className="mt-2 text-sm font-semibold">{getKitchenStatusMeta(order).label}</p>
                                  </div>
                                  <span className="rounded-full bg-black/20 px-3 py-1 text-[10px] font-mono uppercase text-white/80">
                                    {getKitchenItemCount(order)} / {order.items.length} iteme
                                  </span>
                                </div>
                                <p className="mt-2 text-xs leading-5 text-white/80">{getKitchenStatusMeta(order).detail}</p>
                              </div>

                              <div className="rounded-2xl border border-white/8 bg-card px-3 py-3 text-xs text-muted">
                                <p>Actualizat: {formatTimeElapsed(order.updatedAt)}</p>
                                {order.approvedAt && <p className="mt-2">Trimisa de ospatar: {formatTimeElapsed(order.approvedAt)}</p>}
                                {order.startedAt && <p className="mt-2">Bucataria a pornit: {formatTimeElapsed(order.startedAt)}</p>}
                                {order.readyAt && <p className="mt-2">Marcata gata: {formatTimeElapsed(order.readyAt)}</p>}
                              </div>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-2 xl:grid-cols-2">
                              {order.items.map((item) => (
                                <label
                                  key={item.id}
                                  className={`flex items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-sm ${
                                    order.status === OrderStatus.PENDING
                                      ? 'cursor-pointer'
                                      : ''
                                  } ${
                                    order.status === OrderStatus.PENDING &&
                                    (approvalSelections[order.id]?.[item.id] ?? getDefaultKitchenSelection(item.productId, item.sendToKitchen))
                                      ? 'border-primary/20 bg-primary/10'
                                      : 'border-white/8 bg-card/50'
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <span>{item.productName}</span>
                                    {groupSelectedOptions(item.selectedOptions).length > 0 && (
                                      <div className="mt-1 space-y-1">
                                        {groupSelectedOptions(item.selectedOptions).map((group) => (
                                          <p key={`${item.id}-${group.groupId}`} className="text-[11px] text-muted">
                                            {group.groupName}: {group.choices.map((choice) => choice.choiceName).join(', ')}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                    <p className="mt-1 text-[11px] text-muted">
                                      {item.sendToKitchen === false ? 'Servire / bar' : 'Flux bucatarie'}
                                    </p>
                                    {order.status === OrderStatus.PENDING && (
                                      <p className="mt-1 text-[11px] text-muted">
                                        {approvalSelections[order.id]?.[item.id] ?? getDefaultKitchenSelection(item.productId, item.sendToKitchen)
                                          ? 'Merge in bucatarie'
                                          : 'Ramane doar pentru servire / bar'}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-muted font-mono">x{item.quantity}</span>
                                    {order.status === OrderStatus.PENDING ? (
                                      <input
                                        type="checkbox"
                                        checked={approvalSelections[order.id]?.[item.id] ?? getDefaultKitchenSelection(item.productId, item.sendToKitchen)}
                                        onChange={() => toggleKitchenItemSelection(order.id, item.id)}
                                        className="h-4 w-4 accent-primary"
                                      />
                                    ) : null}
                                  </div>
                                </label>
                              ))}
                            </div>

                            {order.status === OrderStatus.PENDING && (
                              <div className="mt-4 rounded-2xl border border-white/8 bg-card px-3 py-3 text-xs text-muted">
                                Selectate pentru bucatarie: {getSelectedKitchenItemCount(order)} / {order.items.length}.
                              </div>
                            )}

                            {order.status === OrderStatus.PENDING && (
                              <div className="mt-4 grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => cancelOrder(order.id)}
                                  className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger flex items-center justify-center gap-2"
                                >
                                  <XCircle className="w-4 h-4" />
                                  Respinge
                                </button>
                                <button
                                  onClick={() => approveOrder(order.id)}
                                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                  Aproba
                                </button>
                              </div>
                            )}

                            {order.status !== OrderStatus.PENDING && (
                              <div className={`mt-4 grid gap-2 ${order.status === OrderStatus.READY ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                <button
                                  onClick={() => cancelOrder(order.id)}
                                  className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger"
                                >
                                  Anuleaza comanda
                                </button>
                                {order.status === OrderStatus.READY && (
                                  <button
                                    onClick={() => deliverOrder(order.id)}
                                    className="rounded-2xl bg-success px-4 py-3 text-sm font-semibold text-black"
                                  >
                                    Marcheaza livrata
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center text-muted">
                Selecteaza o masa pentru a aproba cereri, a adauga comenzi manuale sau a inchide note.
              </div>
            )}
          </div>
        </section>
      </div>

      {pendingEditorOrder && (
        <div className="fixed inset-0 z-[108] flex items-end bg-black/65 px-3 py-3 backdrop-blur md:items-center md:justify-center md:p-6">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-white/10 bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/8 px-4 py-4 md:px-5">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-primary">Completeaza comanda clientului</p>
                <h3 className="mt-2 text-2xl font-display font-bold text-white">
                  Masa {pendingEditorOrder.tableNumber} • {pendingEditorOrder.orderNumber}
                </h3>
                <p className="mt-2 text-sm text-white/70">
                  Comanda curenta are {pendingEditorOrder.items.reduce((sum, item) => sum + item.quantity, 0)} produse si totalul {formatCad(pendingEditorOrder.subtotal)}.
                </p>
              </div>
              <button
                type="button"
                onClick={resetPendingEditor}
                className="rounded-2xl border border-white/10 bg-background px-4 py-3 text-sm font-semibold text-white"
              >
                Inchide
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-[1.25fr_0.75fr]">
              <div className="min-h-0 overflow-y-auto border-b border-white/8 px-4 py-4 xl:border-b-0 xl:border-r xl:px-5">
                <div className="space-y-5">
                  {manualProductGroups.map((group) => (
                    <section key={`pending-${group.id}`}>
                      <div className="mb-3 flex items-center gap-2 px-1">
                        {group.icon ? (
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-card text-xl">
                            {group.icon}
                          </span>
                        ) : null}
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary">Sectiune</p>
                          <p className="text-base font-display font-bold text-white">{group.name}</p>
                        </div>
                      </div>

                      <div className="-mx-1 flex w-full flex-nowrap snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-2 overscroll-x-contain">
                        {group.products.map((product) => {
                          const count = pendingEditorProductQuantities.get(product.id) || 0;
                          const hasOptions = Boolean(product.optionGroups?.length);

                          return (
                            <div
                              key={`pending-product-${product.id}`}
                              className={`relative w-[calc(50%-0.375rem)] min-w-[calc(50%-0.375rem)] max-w-[calc(50%-0.375rem)] shrink-0 snap-start overflow-hidden rounded-[22px] border bg-card transition-all ${
                                count > 0 ? 'border-primary/40 shadow-[0_0_0_1px_rgba(232,122,65,0.3)]' : 'border-white/8'
                              }`}
                            >
                              <div className="relative aspect-[1.16] md:aspect-[0.98]">
                                <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />

                                <button
                                  type="button"
                                  onClick={() => modifyPendingEditorQty(product, -1)}
                                  aria-label={`Scoate ${product.name}`}
                                  className="absolute inset-y-0 left-0 z-10 flex w-1/2 items-start justify-start p-2.5 text-white/80 transition hover:bg-danger/20 active:bg-danger/30 disabled:cursor-not-allowed disabled:opacity-35 md:p-4"
                                  disabled={count === 0}
                                >
                                  <span className="rounded-2xl bg-black/55 p-2.5 md:p-3">
                                    <Minus className="h-4 w-4 md:h-5 md:w-5" />
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => modifyPendingEditorQty(product, 1)}
                                  aria-label={`Adauga ${product.name}`}
                                  className="absolute inset-y-0 right-0 z-10 flex w-1/2 items-start justify-end p-2.5 text-white transition hover:bg-success/20 active:bg-success/30 md:p-4"
                                >
                                  <span className="rounded-2xl bg-primary p-2.5 shadow-lg md:p-3">
                                    <Plus className="h-4 w-4 md:h-5 md:w-5" />
                                  </span>
                                </button>

                                <div className="absolute bottom-2.5 left-2.5 z-10 md:bottom-4 md:left-4">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-mono shadow-lg md:px-4 md:py-2 md:text-sm ${
                                      count > 0 ? 'bg-primary text-white' : 'bg-black/55 text-white/80'
                                    }`}
                                  >
                                    {count > 0 ? `x${count}` : '0'}
                                  </span>
                                </div>
                                {hasOptions && (
                                  <div className="absolute bottom-2.5 right-2.5 z-10 md:bottom-4 md:right-4">
                                    <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-white/80 md:px-3 md:py-1.5">
                                      Optiuni
                                    </span>
                                  </div>
                                )}
                                {!hasOptions && (
                                  <div className="absolute bottom-2.5 right-2.5 z-10 md:bottom-4 md:right-4">
                                    <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-white/80 md:px-3 md:py-1.5">
                                      Nota
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className="space-y-2.5 px-2.5 py-2.5 md:px-4 md:py-4">
                                <p className="min-h-[2.7rem] text-[15px] font-display font-bold leading-5 text-white md:min-h-[3.5rem] md:text-lg md:leading-7">
                                  {product.name}
                                </p>
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-mono uppercase tracking-[0.16em] text-primary md:text-sm md:tracking-[0.18em]">
                                    {formatCad(product.price)}
                                  </p>
                                  <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/50">
                                    {hasOptions ? 'Extra' : 'Nota'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto px-4 py-4 xl:px-5">
                <div className="rounded-[24px] border border-white/8 bg-background/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono uppercase tracking-[0.24em] text-primary">Produse noi</p>
                      <h4 className="mt-2 text-base font-display font-bold">Ce mai adauga ospatarul pe comanda</h4>
                    </div>
                    <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-mono text-primary">
                      {pendingEditorItemCount} produse
                    </span>
                  </div>

                  {pendingEditorItems.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-muted">
                      Nu ai adaugat inca nimic peste comanda clientului.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-2">
                      {pendingEditorItems.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-white/8 bg-card/80 px-3 py-3 text-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold">{item.product.name}</p>
                              {groupSelectedOptions(item.selectedOptions).length > 0 && (
                                <div className="mt-1 space-y-1">
                                  {groupSelectedOptions(item.selectedOptions).map((group) => (
                                    <p key={`${item.id}-${group.groupId}`} className="text-[11px] text-muted">
                                      {group.groupName}: {group.choices.map((choice) => choice.choiceName).join(', ')}
                                    </p>
                                  ))}
                                </div>
                              )}
                              <textarea
                                value={item.notes || ''}
                                onChange={(event) => updatePendingEditorLineNotes(item.id, event.target.value)}
                                placeholder="Nota pentru acest produs..."
                                rows={2}
                                className="mt-3 w-full rounded-2xl border border-white/8 bg-background p-3 text-xs text-white outline-none"
                              />
                              <p className="mt-1 text-[11px] text-white/60">
                                {formatCad(getManualLineUnitPrice(item.product, item.selectedOptions) * item.quantity)}
                              </p>
                            </div>
                            <div className="flex items-center overflow-hidden rounded-2xl border border-white/8 bg-black/20">
                              <button
                                type="button"
                                onClick={() => modifyPendingEditorLineQuantity(item.id, -1)}
                                className="px-3 py-2 text-danger transition hover:bg-danger/15 active:bg-danger/20"
                                aria-label={`Scade ${item.product.name}`}
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="min-w-[44px] px-2 text-center font-mono text-muted">x{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => modifyPendingEditorLineQuantity(item.id, 1)}
                                className="px-3 py-2 text-success transition hover:bg-success/15 active:bg-success/20"
                                aria-label={`Creste ${item.product.name}`}
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 rounded-2xl border border-white/8 bg-card px-3 py-3">
                    <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted">Total suplimentar</p>
                    <p className="mt-2 text-2xl font-display font-bold text-white">{formatCad(pendingEditorTotal)}</p>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={resetPendingEditor}
                      className="flex-1 rounded-2xl border border-white/8 px-4 py-3 text-sm text-muted"
                    >
                      Renunta
                    </button>
                    <button
                      type="button"
                      onClick={savePendingOrderAdditions}
                      disabled={pendingEditorItems.length === 0 || isSavingPendingEditor}
                      className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSavingPendingEditor ? 'Se salveaza...' : 'Adauga pe comanda'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {configProduct && (
        <div className="fixed inset-0 z-[110] flex items-end bg-black/70 px-3 py-3 backdrop-blur md:items-center md:justify-center md:p-6">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[30px] border border-white/10 bg-card shadow-2xl">
            <div className="relative">
              <img
                src={configProduct.imageUrl}
                alt={configProduct.name}
                className="h-44 w-full object-cover md:h-56"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/35 to-transparent" />
              <button
                type="button"
                onClick={closeProductConfigurator}
                className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-black/45 px-3 py-2 text-sm font-semibold text-white"
              >
                Inchide
              </button>
              <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
                <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-primary">Configurare produs</p>
                <h3 className="mt-2 text-2xl font-display font-bold text-white">{configProduct.name}</h3>
                <p className="mt-2 text-sm text-white/75">{formatCad(configProduct.price)} baza</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5">
              <div className="rounded-[24px] border border-white/8 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-mono uppercase tracking-[0.22em] text-muted">Cantitate</p>
                    <p className="mt-2 text-sm text-white/75">Seteaza cate bucati adaugi cu aceasta configurare.</p>
                  </div>
                  <div className="flex items-center overflow-hidden rounded-2xl border border-white/8 bg-card">
                    <button
                      type="button"
                      onClick={() => setConfigQuantity((current) => Math.max(1, current - 1))}
                      className="px-4 py-3 text-danger transition hover:bg-danger/15 active:bg-danger/20"
                      aria-label="Scade cantitatea"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="min-w-[56px] px-3 text-center font-display text-xl font-bold text-white">{configQuantity}</span>
                    <button
                      type="button"
                      onClick={() => setConfigQuantity((current) => current + 1)}
                      className="px-4 py-3 text-success transition hover:bg-success/15 active:bg-success/20"
                      aria-label="Creste cantitatea"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(configProduct.optionGroups || []).map((group) => {
                  const selectedIds = configChoices[group.id] || [];
                  return (
                    <div key={group.id} className="rounded-[24px] border border-white/8 bg-background/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-base font-display font-bold text-white">{group.name}</h4>
                          <p className="mt-1 text-[11px] text-muted">
                            {group.required ? 'Obligatoriu' : 'Optional'} • {group.selectionType === 'single' ? 'O singura alegere' : group.maxSelections ? `Maxim ${group.maxSelections}` : 'Selectie multipla'}
                          </p>
                        </div>
                        {group.required ? (
                          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-primary">
                            Necesara
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {group.choices.map((choice) => {
                          const isSelected = selectedIds.includes(choice.id);
                          return (
                            <button
                              key={choice.id}
                              type="button"
                              onClick={() => toggleConfigChoice(group, choice.id)}
                              className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${
                                isSelected ? 'border-primary/30 bg-primary/10 text-white' : 'border-white/8 bg-card text-white/85'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-semibold">{choice.name}</span>
                                <span className={`rounded-full px-2 py-1 text-[10px] font-mono ${isSelected ? 'bg-primary text-white' : 'bg-black/25 text-white/60'}`}>
                                  {formatOptionPriceDelta(choice.priceDelta)}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-[24px] border border-white/8 bg-background/70 p-4">
                <p className="text-xs font-mono uppercase tracking-[0.22em] text-muted">Nota produs</p>
                <p className="mt-2 text-sm text-white/75">Adauga cerinte speciale pentru aceasta pozitie.</p>
                <textarea
                  value={configLineNotes}
                  onChange={(event) => setConfigLineNotes(event.target.value)}
                  placeholder="Ex: fara zahar pudra, extra dulceata, bine rumenit..."
                  rows={3}
                  className="mt-3 w-full rounded-2xl border border-white/8 bg-card p-3 text-sm text-white outline-none"
                />
              </div>
            </div>

            <div className="border-t border-white/8 bg-background/95 p-4 md:p-5">
              {groupSelectedOptions(configSelectedOptions).length > 0 && (
                <div className="mb-3 rounded-2xl border border-white/8 bg-card px-3 py-3">
                  {groupSelectedOptions(configSelectedOptions).map((group) => (
                    <p key={group.groupId} className="text-xs text-muted">
                      {group.groupName}: {group.choices.map((choice) => choice.choiceName).join(', ')}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-primary">Total configurare</p>
                  <p className="mt-2 text-2xl font-display font-bold text-white">
                    {formatCad(configUnitPrice * configQuantity)}
                  </p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <button
                    type="button"
                    onClick={closeProductConfigurator}
                    className="flex-1 rounded-2xl border border-white/8 px-4 py-3 text-sm text-muted sm:flex-none sm:min-w-[120px]"
                  >
                    Renunta
                  </button>
                  <button
                    type="button"
                    onClick={addConfiguredProduct}
                    className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white sm:flex-none sm:min-w-[190px]"
                  >
                      Adauga in draft
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
