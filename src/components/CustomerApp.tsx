import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock,
  Minus,
  Plus,
  Search,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { api } from '../services/api.js';
import { Bill, BillStatus, CartItem, Category, Order, OrderSource, OrderStatus, Product, ProductOptionGroup, RestaurantSettings, SelectedOrderOption, Table, TableStatus } from '../types.js';
import { formatCad, formatOptionPriceDelta, getOrderStatusLabel, getPaymentMethodLabel, getSelectedOptionsTotal, groupSelectedOptions } from '../utils.js';

interface CustomerAppProps {
  tableId: string;
  tables: Table[];
}

interface RememberedCustomerSession {
  tableId: string;
  sessionId: string;
  orderIds: string[];
  expiresAt: number;
}

interface WaiterCallMarker {
  tableId: string;
  calledAt: number;
  expiresAt: number;
}

interface CustomerPopupState {
  title: string;
  message: string;
  tone: 'success' | 'error';
}

const trackerStages = [
  { status: OrderStatus.PENDING, label: 'Asteapta ospatarul' },
  { status: OrderStatus.CONFIRMED, label: 'Confirmata' },
  { status: OrderStatus.PREPARING, label: 'In pregatire' },
  { status: OrderStatus.READY, label: 'Gata' },
  { status: OrderStatus.DELIVERED, label: 'Livrata' },
];

const ORDER_COOKIE_TTL_MS = 2 * 60 * 60 * 1000;
const WAITER_CALL_MARKER_TTL_MS = 10 * 60 * 1000;

function getCookie(name: string) {
  if (typeof document === 'undefined') {
    return '';
  }

  const cookies = document.cookie ? document.cookie.split('; ') : [];
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : '';
}

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; samesite=lax`;
}

function clearCookie(name: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=; max-age=0; path=/; samesite=lax`;
}

function scrollFieldIntoView(target: HTMLInputElement | HTMLTextAreaElement) {
  window.setTimeout(() => {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 180);
}

function createCartLineId() {
  return `cart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSelectedOptionSignature(selectedOptions?: SelectedOrderOption[]) {
  return [...(selectedOptions || [])]
    .map((option) => `${option.groupId}:${option.choiceId}`)
    .sort()
    .join('|');
}

function getLineUnitPrice(product: Product, selectedOptions?: SelectedOrderOption[]) {
  return product.price + getSelectedOptionsTotal(selectedOptions);
}

function normalizeCartItem(raw: any): CartItem | null {
  if (!raw?.product?.id) {
    return null;
  }

  return {
    id: typeof raw.id === 'string' ? raw.id : createCartLineId(),
    product: raw.product,
    quantity: Math.max(1, Number(raw.quantity || 1)),
    notes: raw.notes ? String(raw.notes) : undefined,
    selectedOptions: Array.isArray(raw.selectedOptions) ? raw.selectedOptions : [],
  };
}

function buildSelectedOptions(product: Product, selectedChoicesByGroup: Record<string, string[]>): SelectedOrderOption[] {
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

export default function CustomerApp({ tableId, tables }: CustomerAppProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings>({ customerOrderingEnabled: true });
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [nutritionProduct, setNutritionProduct] = useState<Product | null>(null);
  const [productQuantity, setProductQuantity] = useState(1);
  const [productNotes, setProductNotes] = useState('');
  const [selectedProductChoices, setSelectedProductChoices] = useState<Record<string, string[]>>({});
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);
  const [rememberedSessionId, setRememberedSessionId] = useState('');
  const [additionalOrderNotes, setAdditionalOrderNotes] = useState('');
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [reviewOrder, setReviewOrder] = useState<Order | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [isReviewSubmitted, setIsReviewSubmitted] = useState(false);
  const [feedbackPopup, setFeedbackPopup] = useState<CustomerPopupState | null>(null);
  const [waiterCallMarker, setWaiterCallMarker] = useState<WaiterCallMarker | null>(null);

  const activeTable = tables.find((table) => table.id === tableId) || tables[0] || null;
  const rememberedSessionCookieName = `restaurant-order-session-${tableId}`;
  const waiterCallStorageKey = `restaurant-waiter-call-${tableId}`;

  const upsertActiveOrder = (incomingOrder: Order) => {
    if (incomingOrder.tableId !== tableId) {
      return;
    }

    setActiveOrders((currentOrders) => {
      const existingIndex = currentOrders.findIndex((order) => order.id === incomingOrder.id);
      if (existingIndex === -1) {
        return [incomingOrder, ...currentOrders];
      }

      const nextOrders = [...currentOrders];
      nextOrders[existingIndex] = incomingOrder;
      return nextOrders;
    });

    if (incomingOrder.status === OrderStatus.DELIVERED) {
      setReviewOrder(incomingOrder);
      setReviewComment('');
      setReviewRating(5);
      setIsReviewSubmitted(false);
    }
  };

  const readRememberedSession = (): RememberedCustomerSession | null => {
    if (!tableId) {
      return null;
    }

    try {
      const rawCookie = getCookie(rememberedSessionCookieName);
      if (!rawCookie) {
        return null;
      }

      const parsed = JSON.parse(rawCookie) as RememberedCustomerSession;
      if (
        parsed.tableId !== tableId ||
        !parsed.sessionId ||
        !Array.isArray(parsed.orderIds) ||
        parsed.expiresAt <= Date.now()
      ) {
        clearCookie(rememberedSessionCookieName);
        return null;
      }

      return parsed;
    } catch (error) {
      console.error('Nu am putut citi cookie-ul cu comenzile memorate', error);
      clearCookie(rememberedSessionCookieName);
      return null;
    }
  };

  const rememberOrderOnDevice = (order: Order) => {
    if (!tableId) {
      return;
    }

    const currentCookie = readRememberedSession();
    const nextPayload: RememberedCustomerSession = {
      tableId,
      sessionId: order.sessionId,
      orderIds:
        currentCookie?.sessionId === order.sessionId
          ? [...new Set([...currentCookie.orderIds, order.id])]
          : [order.id],
      expiresAt: Date.now() + ORDER_COOKIE_TTL_MS,
    };

    setRememberedSessionId(nextPayload.sessionId);
    setCookie(
      rememberedSessionCookieName,
      JSON.stringify(nextPayload),
      Math.floor(ORDER_COOKIE_TTL_MS / 1000)
    );
  };

  const saveCart = (nextCart: CartItem[]) => {
    setCart(nextCart);
    if (!tableId) {
      return;
    }

    try {
      localStorage.setItem(`cart-table-${tableId}`, JSON.stringify(nextCart));
    } catch (error) {
      console.error('Nu am putut salva cosul', error);
    }
  };

  const readWaiterCallMarker = (): WaiterCallMarker | null => {
    if (!tableId) {
      return null;
    }

    try {
      const raw = localStorage.getItem(waiterCallStorageKey);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as WaiterCallMarker;
      if (parsed.tableId !== tableId || parsed.expiresAt <= Date.now()) {
        localStorage.removeItem(waiterCallStorageKey);
        return null;
      }

      return parsed;
    } catch (error) {
      console.error('Nu am putut citi marcajul de chemare ospatar', error);
      localStorage.removeItem(waiterCallStorageKey);
      return null;
    }
  };

  const persistWaiterCallMarker = () => {
    if (!tableId) {
      return;
    }

    const nextMarker: WaiterCallMarker = {
      tableId,
      calledAt: Date.now(),
      expiresAt: Date.now() + WAITER_CALL_MARKER_TTL_MS,
    };

    setWaiterCallMarker(nextMarker);
    try {
      localStorage.setItem(waiterCallStorageKey, JSON.stringify(nextMarker));
    } catch (error) {
      console.error('Nu am putut salva marcajul de chemare ospatar', error);
    }
  };

  useEffect(() => {
    if (!tableId) {
      return;
    }

    try {
      const persisted = localStorage.getItem(`cart-table-${tableId}`);
      if (persisted) {
        const parsed = JSON.parse(persisted);
        setCart(Array.isArray(parsed) ? parsed.map(normalizeCartItem).filter(Boolean) as CartItem[] : []);
      } else {
        setCart([]);
      }
    } catch (error) {
      console.error('Nu am putut incarca cosul', error);
    }

    setWaiterCallMarker(readWaiterCallMarker());
  }, [tableId]);

  useEffect(() => {
    if (!tableId) {
      return;
    }

    const rememberedSession = readRememberedSession();
    setRememberedSessionId(rememberedSession?.sessionId || '');

    const loadData = async () => {
      try {
        const [categoryList, productList, orderList, billList, settingsData] = await Promise.all([
          api.getCategories(),
          api.getProducts(),
          api.getOrders(),
          api.getBills(),
          api.getSettings(),
        ]);

        setCategories(categoryList.filter((category) => category.active));
        setProducts(productList.filter((product) => product.available));
        setActiveOrders(orderList.filter((order) => order.tableId === tableId));
        setBills(billList.filter((bill) => bill.tableId === tableId));
        setSettings(settingsData);
      } catch (error) {
        console.error('Nu am putut incarca datele pentru client', error);
      }
    };

    loadData();

    const unsubOrderUpdate = api.subscribe('order-update', upsertActiveOrder);
    const unsubNewOrder = api.subscribe('new-order', upsertActiveOrder);
    const unsubNewOrderRequest = api.subscribe('new-order-request', upsertActiveOrder);
    const unsubTable = api.subscribe('table-update', (table: Table) => {
      if (table.id === tableId) {
        loadData();
      }
    });
    const unsubMenu = api.subscribe('menu-update', loadData);
    const unsubSettings = api.subscribe('settings-update', (nextSettings: RestaurantSettings) => {
      setSettings(nextSettings);
    });
    const unsubBill = api.subscribe('bill-update', loadData);
    const unsubDatabaseReset = api.subscribe('database-reset', loadData);

    return () => {
      unsubOrderUpdate();
      unsubNewOrder();
      unsubNewOrderRequest();
      unsubTable();
      unsubMenu();
      unsubSettings();
      unsubBill();
      unsubDatabaseReset();
    };
  }, [tableId]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const isOverlayOpen = Boolean(selectedProduct || nutritionProduct || isCartOpen || isTrackerOpen || reviewOrder || feedbackPopup);
    if (!isOverlayOpen) {
      return;
    }

    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [feedbackPopup, isCartOpen, isTrackerOpen, nutritionProduct, reviewOrder, selectedProduct]);

  useEffect(() => {
    if (!waiterCallMarker) {
      return;
    }

    const remaining = waiterCallMarker.expiresAt - Date.now();
    if (remaining <= 0) {
      setWaiterCallMarker(null);
      try {
        localStorage.removeItem(waiterCallStorageKey);
      } catch (error) {
        console.error('Nu am putut sterge marcajul expirat de chemare ospatar', error);
      }
      return;
    }

    const timeout = window.setTimeout(() => {
      setWaiterCallMarker(null);
      try {
        localStorage.removeItem(waiterCallStorageKey);
      } catch (error) {
        console.error('Nu am putut sterge marcajul expirat de chemare ospatar', error);
      }
    }, remaining);

    return () => window.clearTimeout(timeout);
  }, [waiterCallMarker, waiterCallStorageKey]);

  const featuredBestsellers = useMemo(
    () => products.filter((product) => product.isBestseller).slice(0, 4),
    [products]
  );

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchesCategory = selectedCategory === 'all' || product.categoryId === selectedCategory;
        const matchesSearch =
          product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          product.description.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
      }),
    [products, searchQuery, selectedCategory]
  );

  const cartTotal = cart.reduce((sum, item) => sum + getLineUnitPrice(item.product, item.selectedOptions) * item.quantity, 0);
  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const selectedProductOptions = selectedProduct ? buildSelectedOptions(selectedProduct, selectedProductChoices) : [];
  const selectedProductUnitPrice = selectedProduct ? getLineUnitPrice(selectedProduct, selectedProductOptions) : 0;
  const currentSessionId = rememberedSessionId;
  const sessionOrders = useMemo(
    () =>
      activeOrders.filter((order) => {
        if (!currentSessionId) {
          return false;
        }

        return order.sessionId === currentSessionId;
      }),
    [activeOrders, currentSessionId]
  );
  const sessionBills = useMemo(
    () =>
      bills.filter((bill) => {
        if (!currentSessionId) {
          return false;
        }

        return bill.sessionId === currentSessionId;
      }),
    [bills, currentSessionId]
  );
  const sessionTotal = useMemo(
    () =>
      sessionOrders
        .filter((order) => order.status !== OrderStatus.CANCELLED)
        .reduce((sum, order) => sum + order.subtotal, 0),
    [sessionOrders]
  );
  const currentOpenBill = sessionBills.find((bill) => bill.status !== BillStatus.PAID) || null;

  const toggleProductChoice = (group: ProductOptionGroup, choiceId: string) => {
    setSelectedProductChoices((current) => {
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
      const nextValues = maxSelections ? [...preservedExisting, choiceId] : [...existing, choiceId];
      return {
        ...current,
        [group.id]: nextValues,
      };
    });
  };

  const addToCart = (product: Product, quantity: number, notes: string, selectedOptions: SelectedOrderOption[]) => {
    const missingRequiredGroup = (product.optionGroups || []).find(
      (group) => group.required && !selectedOptions.some((option) => option.groupId === group.id)
    );
    if (missingRequiredGroup) {
      alert(`Selecteaza o optiune pentru "${missingRequiredGroup.name}".`);
      return;
    }

    const normalizedNotes = notes.trim();
    const existingIndex = cart.findIndex(
      (item) =>
        item.product.id === product.id &&
        (item.notes || '') === normalizedNotes &&
        getSelectedOptionSignature(item.selectedOptions) === getSelectedOptionSignature(selectedOptions)
    );
    const nextCart = [...cart];

    if (existingIndex >= 0) {
      nextCart[existingIndex].quantity += quantity;
    } else {
      nextCart.push({
        id: createCartLineId(),
        product,
        quantity,
        notes: normalizedNotes || undefined,
        selectedOptions,
      });
    }

    saveCart(nextCart);
    setSelectedProduct(null);
    setProductQuantity(1);
    setProductNotes('');
    setSelectedProductChoices({});
  };

  const updateCartQuantity = (cartItemId: string, delta: number) => {
    const nextCart = cart
      .map((item) => {
        if (item.id !== cartItemId) {
          return item;
        }

        const nextQuantity = item.quantity + delta;
        return nextQuantity > 0 ? { ...item, quantity: nextQuantity } : null;
      })
      .filter(Boolean) as CartItem[];

    saveCart(nextCart);
  };

  const checkoutOrder = async () => {
    if (!tableId || cart.length === 0) {
      return;
    }

    if (!settings.customerOrderingEnabled) {
      try {
        await api.createWaiterRequest(
          tableId,
          cart.map((item) => ({
            productId: item.product.id,
            productName: item.product.name,
            quantity: item.quantity,
            notes: item.notes,
            selectedOptions: item.selectedOptions,
          })),
          additionalOrderNotes
        );
        setIsCartOpen(false);
        persistWaiterCallMarker();
        setFeedbackPopup({
          title: `Ospatarul a fost chemat la masa ${activeTable.number}`,
          message: 'Cosul tau ramane salvat ca sa il poti arata ospatarului cand ajunge la masa.',
          tone: 'success',
        });
      } catch (error) {
        console.error('Nu am putut chema ospatarul', error);
        setFeedbackPopup({
          title: 'Nu am putut chema ospatarul',
          message: 'Incearca din nou peste cateva secunde.',
          tone: 'error',
        });
      }
      return;
    }

    try {
      const orderItems = cart.map((item) => ({
        productId: item.product.id,
        productName: item.product.name,
        price: getLineUnitPrice(item.product, item.selectedOptions),
        quantity: item.quantity,
        notes: item.notes,
        selectedOptions: item.selectedOptions,
      }));

      const createdOrder = await api.createOrder(
        tableId,
        orderItems,
        additionalOrderNotes,
        OrderSource.CUSTOMER,
        rememberedSessionId || undefined
      );

      rememberOrderOnDevice(createdOrder);
      upsertActiveOrder(createdOrder);
      saveCart([]);
      setAdditionalOrderNotes('');
      setWaiterCallMarker(null);
      try {
        localStorage.removeItem(waiterCallStorageKey);
      } catch (error) {
        console.error('Nu am putut sterge marcajul de chemare ospatar', error);
      }
      setIsCartOpen(false);
      setIsTrackerOpen(true);
    } catch (error) {
      console.error('Nu am putut crea comanda', error);
      setFeedbackPopup({
        title: 'Nu am putut trimite comanda',
        message: 'Cererea de comanda nu a putut fi trimisa. Incearca din nou.',
        tone: 'error',
      });
    }
  };

  const requestBill = async (paymentMethod: 'CARD' | 'CASH') => {
    if (!currentSessionId) {
      setFeedbackPopup({
        title: 'Nu exista sesiune activa',
        message: 'Pe acest dispozitiv nu exista inca o sesiune proprie activa pentru nota.',
        tone: 'error',
      });
      return;
    }

    if (currentOpenBill) {
      setFeedbackPopup({
        title: 'Nota este deja ceruta',
        message: 'Nota a fost deja ceruta pentru aceasta masa. Ospatarul ajunge imediat.',
        tone: 'error',
      });
      return;
    }

    const payableOrders = sessionOrders.filter((order) => order.status !== OrderStatus.CANCELLED);
    if (payableOrders.length === 0) {
      setFeedbackPopup({
        title: 'Nu exista comenzi active',
        message: 'Nu exista inca nicio comanda activa pe aceasta masa.',
        tone: 'error',
      });
      return;
    }

    try {
      const bill = await api.requestBill(
        tableId,
        payableOrders.map((order) => order.id),
        paymentMethod
      );
      setBills((currentBills) => {
        const existingIndex = currentBills.findIndex((entry) => entry.id === bill.id);
        if (existingIndex === -1) {
          return [bill, ...currentBills];
        }

        const nextBills = [...currentBills];
        nextBills[existingIndex] = bill;
        return nextBills;
      });
      setFeedbackPopup({
        title: 'Cerere nota trimisa',
        message: `Nota a fost ceruta. Ospatarul va veni imediat pentru plata ${paymentMethod.toLowerCase()}.`,
        tone: 'success',
      });
    } catch (error) {
      console.error('Nu am putut cere nota', error);
      setFeedbackPopup({
        title: 'Nu am putut cere nota',
        message: error instanceof Error ? error.message : 'Cererea pentru nota a esuat. Incearca din nou.',
        tone: 'error',
      });
    }
  };

  const submitReview = async () => {
    if (!reviewOrder) {
      return;
    }

    try {
      await api.createReview(
        reviewOrder.id,
        reviewRating,
        reviewComment,
        reviewOrder.items[0]?.productId,
        reviewOrder.items[0]?.productName,
        `Masa ${activeTable?.number || tableId}`
      );
      setIsReviewSubmitted(true);
      setTimeout(() => setReviewOrder(null), 1500);
    } catch (error) {
      console.error('Nu am putut trimite recenzia', error);
    }
  };

  if (!tableId || !activeTable) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5">
        <div className="max-w-md w-full bg-card border border-white/10 rounded-[28px] p-6 text-center">
          <p className="text-xs font-mono uppercase tracking-[0.35em] text-muted">Lipseste linkul mesei</p>
          <h1 className="mt-3 text-2xl font-display font-bold">Acest meniu are nevoie de un numar de masa.</h1>
          <p className="mt-3 text-sm text-muted leading-6">
            Deschide linkul QR generat pentru o masa, de exemplu <span className="text-white">/meniu?table=3</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[430px] mx-auto min-h-screen pb-32 border-x border-white/5 bg-background">
      <header className="sticky top-0 z-20 px-4 pt-5 pb-4 bg-background/95 backdrop-blur border-b border-white/5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.3em] text-primary">Meniu client</p>
            <h1 className="mt-2 text-2xl font-display font-bold">Masa {activeTable.number}</h1>
          </div>
          <button
            onClick={() => setIsTrackerOpen(true)}
            className="px-4 py-2 rounded-full bg-card border border-primary/25 text-xs font-semibold text-primary"
          >
            Vezi Statusul comenzii
          </button>
        </div>

        {waiterCallMarker && !settings.customerOrderingEnabled && (
          <div className="mt-4 rounded-2xl border border-warning/20 bg-warning/10 px-4 py-3">
            <p className="text-xs font-mono uppercase tracking-[0.25em] text-warning">Ospatar chemat</p>
            <p className="mt-2 text-sm text-white/85 leading-6">
              Cererea ta a fost trimisa. Poti pastra cosul deschis ca sa ii arati ospatarului ce vrei sa comanzi.
            </p>
          </div>
        )}

        <div className="mt-4 relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Cauta produse in meniu..."
            className="w-full rounded-2xl border border-white/8 bg-card py-2.5 pl-10 pr-4 text-sm text-white outline-none focus:border-primary/40"
          />
        </div>

        {/* {!settings.customerOrderingEnabled && (
          <div className="mt-4 rounded-2xl border border-warning/20 bg-warning/10 px-4 py-3">
            <p className="text-xs font-mono uppercase tracking-[0.25em] text-warning">Comanda din telefon oprita</p>
            <p className="mt-2 text-sm text-white/85 leading-6">
              Poti vedea meniul si statusul comenzilor tale, dar trimiterea comenzii se face momentan doar prin ospatar.
            </p>
          </div>
        )} */}

        <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-4 py-2 rounded-full text-xs font-semibold border ${
              selectedCategory === 'all'
                ? 'bg-primary border-primary text-white'
                : 'bg-card border-white/8 text-muted'
            }`}
          >
            Toate
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2 rounded-full text-xs font-semibold border whitespace-nowrap ${
                selectedCategory === category.id
                  ? 'bg-primary border-primary text-white'
                  : 'bg-card border-white/8 text-muted'
              }`}
            >
              {category.icon} {category.name}
            </button>
          ))}
        </div>
      </header>

      <main className="px-4 py-5 flex flex-col gap-6">
        {!searchQuery && selectedCategory === 'all' && featuredBestsellers.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-mono uppercase tracking-[0.3em] text-primary">Populare acum</h2>
              <span className="text-xs text-muted">Alegerea bucatarului</span>
            </div>
            <div className="flex gap-3 overflow-x-auto no-scrollbar">
              {featuredBestsellers.map((product) => (
                <div
                  key={product.id}
                  className="min-w-[250px] text-left rounded-[24px] overflow-hidden bg-card border border-white/8"
                >
                  <button
                    onClick={() => {
                      setSelectedProduct(product);
                      setProductQuantity(1);
                      setProductNotes('');
                      setSelectedProductChoices({});
                    }}
                    className="w-full text-left"
                  >
                    <img src={product.imageUrl} alt={product.name} className="w-full h-36 object-cover" />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-display font-bold">{product.name}</h3>
                          <p className="mt-1 text-xs text-muted line-clamp-2">{product.description}</p>
                        </div>
                        <span className="text-xs font-mono text-primary">{formatCad(product.price)}</span>
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-mono uppercase tracking-[0.3em] text-muted">Meniu</h2>
            <span className="text-xs text-muted">{filteredProducts.length} produse</span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="rounded-[24px] border border-white/8 bg-card p-3"
              >
                <button
                  onClick={() => {
                    setSelectedProduct(product);
                    setProductQuantity(1);
                    setProductNotes('');
                    setSelectedProductChoices({});
                  }}
                  className="w-full text-left flex gap-4"
                >
                  <img src={product.imageUrl} alt={product.name} className="w-24 h-24 rounded-2xl object-cover" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-display font-bold leading-5">{product.name}</h3>
                      <span className="text-xs font-mono text-primary">{formatCad(product.price)}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted line-clamp-2 leading-5">{product.description}</p>
                      <div className="mt-3 flex items-center justify-end text-[11px] text-muted">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {product.prepTime} min
                        </span>
                      </div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>

      {isTrackerOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center overscroll-none">
          <div className="absolute inset-0" onClick={() => setIsTrackerOpen(false)} />
          <div className="relative z-10 w-full max-w-[430px] h-[100dvh] max-h-[100dvh] rounded-t-[32px] bg-card border-t border-white/10 flex flex-col overflow-hidden sm:h-auto sm:max-h-[88dvh]">
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-white/5 bg-card/95 backdrop-blur px-5 py-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.3em] text-primary">Sesiune activa</p>
                <h3 className="mt-2 text-xl font-display font-bold">Status masa {activeTable.number}</h3>
              </div>
              <button
                onClick={() => setIsTrackerOpen(false)}
                className="w-9 h-9 rounded-full bg-background border border-white/8 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-[24px] border border-white/8 bg-background p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.25em] text-muted">Total sesiune</p>
                <p className="mt-3 text-2xl font-display font-bold">{formatCad(sessionTotal)}</p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-background p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.25em] text-muted">Comenzi in sesiune</p>
                <p className="mt-3 text-2xl font-display font-bold">{sessionOrders.length}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              {rememberedSessionId ? (
                <span className="rounded-full border border-warning/25 bg-warning/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.2em] text-warning">
                    Sesiune salvata pe acest dispozitiv 2h
                </span>
              ) : null}
            </div>

            <div className="mt-4 rounded-[24px] border border-primary/15 bg-background/70 p-4">
              <p className="text-xs text-muted leading-6">
                {rememberedSessionId
                  ? 'Aici vezi doar comenzile trimise de pe acest dispozitiv. Alte persoane de la aceeasi masa nu iti vad comenzile si nici tu pe ale lor.'
                  : 'Comenzile apar aici doar dupa ce trimiti ceva de pe acest dispozitiv. Nu se mai afiseaza istoricul altor persoane de la aceeasi masa.'}
              </p>
            </div>

            {!currentSessionId ? (
              <div className="mt-4 rounded-[24px] border border-white/8 bg-background px-4 py-8 text-center text-sm text-muted">
                  Nu exista acum nicio sesiune activa de comanda pe aceasta masa.
              </div>
            ) : sessionOrders.length === 0 ? (
              <div className="mt-4 rounded-[24px] border border-white/8 bg-background px-4 py-8 text-center text-sm text-muted">
                  Nu a fost adaugata inca nicio comanda in aceasta sesiune.
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-4">
                {sessionOrders.map((order) => {
                  const currentStageIndex = trackerStages.findIndex((stage) => stage.status === order.status);
                  const cancelled = order.status === OrderStatus.CANCELLED;

                  return (
                    <div key={order.id} className="rounded-[26px] border border-white/8 bg-background p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-base font-display font-bold">{order.orderNumber}</h4>
                          <p className="mt-1 text-xs text-muted">
                            {order.items.length} items • {formatCad(order.subtotal)}
                          </p>
                        </div>
                          <span className="text-[11px] font-mono uppercase text-primary">{getOrderStatusLabel(order.status)}</span>
                      </div>

                      <div className="mt-3 space-y-2">
                        {order.items.map((item) => (
                          <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
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
                            </div>
                            <span className="text-muted font-mono">x{item.quantity}</span>
                          </div>
                        ))}
                      </div>

                      {!cancelled ? (
                        <div className="mt-5 flex flex-col gap-1">
                          {trackerStages.map((stage, index) => {
                            const reached = index <= currentStageIndex;
                            const isCurrentStage = order.status === stage.status;
                            const isLastStage = index === trackerStages.length - 1;

                            return (
                              <div key={stage.status} className="flex gap-3">
                                <div className="flex flex-col items-center">
                                  <div
                                    className={`w-8 h-8 rounded-full border flex items-center justify-center ${
                                      reached ? 'bg-primary border-primary' : 'bg-card border-white/10'
                                    }`}
                                  >
                                    {reached && <Check className="w-4 h-4 text-white" />}
                                  </div>
                                  {!isLastStage && (
                                    <div className={`mt-1 w-px min-h-8 ${reached ? 'bg-primary' : 'bg-white/10'}`} />
                                  )}
                                </div>
                                <div className="pt-1 pb-4">
                                  <p className={`text-sm ${reached ? 'text-white' : 'text-muted'}`}>{stage.label}</p>
                                    {isCurrentStage && <p className="mt-1 text-xs text-primary">Etapa curenta</p>}
                                </div>
                              </div>
                            );
                          })}

                          {order.status === OrderStatus.PREPARING && order.prepTimeEstimate && (
                            <div className="rounded-xl bg-card border border-white/8 px-3 py-2 text-xs text-warning">
                              Timp estimat in bucatarie: {order.prepTimeEstimate} minute
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
                            Aceasta comanda a fost anulata de personal.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            </div>

            <div className="shrink-0 border-t border-white/10 bg-card/95 backdrop-blur px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <p className="text-[11px] text-muted text-center mb-3">Vrei nota pentru aceasta sesiune?</p>
              {currentOpenBill && (
                <div className="mb-3 rounded-xl border border-success/20 bg-success/10 px-3 py-2 text-xs text-success text-center">
                  Nota a fost deja ceruta. Metoda de plata: {getPaymentMethodLabel(currentOpenBill.paymentMethod || 'CASH')}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => requestBill('CARD')}
                  disabled={!currentSessionId || Boolean(currentOpenBill)}
                  className="rounded-2xl border border-white/8 bg-background px-3 py-3 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Plata cu cardul
                </button>
                <button
                  onClick={() => requestBill('CASH')}
                  disabled={!currentSessionId || Boolean(currentOpenBill)}
                  className="rounded-2xl border border-white/8 bg-background px-3 py-3 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Plata cash
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cart.length > 0 && !isCartOpen && (
        <div className="fixed bottom-4 left-4 right-4 max-w-[398px] mx-auto z-40">
          <button
            onClick={() => setIsCartOpen(true)}
            className="w-full rounded-[24px] bg-primary text-white px-5 py-4 flex items-center justify-between shadow-2xl"
          >
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5" />
              <span className="rounded-full bg-white text-primary px-2 py-0.5 text-xs font-bold">{totalCartCount}</span>
            </div>
            <span className="text-xs font-mono uppercase tracking-[0.25em]">Vezi comanda</span>
            <span className="text-sm font-mono">{formatCad(cartTotal)}</span>
          </button>
        </div>
      )}

      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center overscroll-none">
          <div className="absolute inset-0" onClick={() => setSelectedProduct(null)} />
          <div className="relative z-10 w-full max-w-[430px] h-[100dvh] max-h-[100dvh] rounded-t-[32px] bg-card border-t border-white/10 flex flex-col overflow-hidden sm:h-auto sm:max-h-[85dvh]">
            <div className="shrink-0 flex items-center justify-between border-b border-white/5 bg-card/95 backdrop-blur px-5 py-4">
              <p className="text-xs font-mono uppercase tracking-[0.3em] text-primary">Detalii produs</p>
              <button
                onClick={() => setSelectedProduct(null)}
                className="w-9 h-9 rounded-full bg-background border border-white/8 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
              <img
                src={selectedProduct.imageUrl}
                alt={selectedProduct.name}
                className="w-full h-52 rounded-[24px] object-cover mt-4"
              />

              <div className="mt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-2xl font-display font-bold">{selectedProduct.name}</h3>
                    <p className="mt-2 text-sm text-muted leading-6">{selectedProduct.description}</p>
                  </div>
                  <span className="text-sm font-mono text-primary">{formatCad(selectedProduct.price)}</span>
                </div>

                {selectedProduct.ingredients && selectedProduct.ingredients.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedProduct.ingredients.map((ingredient) => (
                      <span
                        key={ingredient.id}
                        className="rounded-full border border-white/8 bg-background px-3 py-1.5 text-xs text-white"
                      >
                        {ingredient.icon} {ingredient.name}
                      </span>
                    ))}
                  </div>
                )}

                {selectedProduct.allergens && selectedProduct.allergens.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/10 p-4 flex gap-3">
                    <Shield className="w-4 h-4 text-danger mt-0.5" />
                    <div className="text-xs leading-6 text-white/85">
                    Contine: <span className="text-danger">{selectedProduct.allergens.join(', ')}</span>
                    </div>
                  </div>
                )}

                {selectedProduct.nutritionInfo && (
                  <button
                    onClick={() => setNutritionProduct(selectedProduct)}
                    className="mt-4 w-full rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm font-semibold text-white"
                  >
                    Vezi informatiile nutritionale
                  </button>
                )}

                {(selectedProduct.optionGroups || []).length > 0 && (
                  <div className="mt-5 space-y-3">
                    {(selectedProduct.optionGroups || []).map((group) => {
                      const selectedIds = selectedProductChoices[group.id] || [];
                      return (
                        <div key={group.id} className="rounded-2xl border border-white/8 bg-background p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{group.name}</p>
                              <p className="mt-1 text-[11px] text-muted">
                                {group.selectionType === 'single'
                                  ? group.required
                                    ? 'Alege o varianta'
                                    : 'Alege o varianta, daca vrei'
                                  : group.maxSelections
                                    ? `Poti alege pana la ${group.maxSelections}`
                                    : 'Poti alege mai multe variante'}
                              </p>
                            </div>
                            {group.required && (
                              <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-mono uppercase text-primary">
                                Obligatoriu
                              </span>
                            )}
                          </div>

                          <div className="mt-3 space-y-2">
                            {group.choices.map((choice) => {
                              const active = selectedIds.includes(choice.id);
                              return (
                                <button
                                  key={choice.id}
                                  type="button"
                                  onClick={() => toggleProductChoice(group, choice.id)}
                                  className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left ${
                                    active ? 'border-primary/30 bg-primary/10' : 'border-white/8 bg-card'
                                  }`}
                                >
                                  <div>
                                    <p className="text-sm font-medium text-white">{choice.name}</p>
                                    <p className="mt-1 text-[11px] text-muted">{formatOptionPriceDelta(choice.priceDelta)}</p>
                                  </div>
                                  <span
                                    className={`h-5 w-5 rounded-full border ${
                                      active ? 'border-primary bg-primary' : 'border-white/10 bg-background'
                                    }`}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-5">
                <label className="text-xs font-mono uppercase tracking-[0.25em] text-muted">Nota produs</label>
                <textarea
                  value={productNotes}
                  onChange={(event) => setProductNotes(event.target.value)}
                  onFocus={(event) => scrollFieldIntoView(event.currentTarget)}
                  placeholder="Adauga cerinte speciale"
                  rows={4}
                  className="mt-2 w-full rounded-2xl border border-white/8 bg-background p-3 text-sm text-white outline-none resize-none"
                />
              </div>
            </div>

            <div className="shrink-0 border-t border-white/10 bg-card/95 backdrop-blur px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-4">
                <div className="flex items-center rounded-2xl border border-white/8 bg-background p-1">
                  <button
                    onClick={() => setProductQuantity((current) => Math.max(1, current - 1))}
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-10 text-center text-sm font-mono">{productQuantity}</span>
                  <button
                    onClick={() => setProductQuantity((current) => current + 1)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={() => addToCart(selectedProduct, productQuantity, productNotes, selectedProductOptions)}
                  className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold flex items-center justify-between"
                >
                  <span>Adauga in comanda</span>
                  <span>{formatCad(selectedProductUnitPrice * productQuantity)}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {nutritionProduct?.nutritionInfo && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={() => setNutritionProduct(null)} />
          <div className="relative z-10 w-full max-w-[520px] max-h-[88dvh] rounded-[32px] border border-white/10 bg-card flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-white/5 bg-card/95 backdrop-blur px-5 py-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.3em] text-primary">Informatii nutritionale</p>
                <h3 className="mt-2 text-xl font-display font-bold">{nutritionProduct.name}</h3>
              </div>
              <button
                onClick={() => setNutritionProduct(null)}
                className="w-9 h-9 rounded-full bg-background border border-white/8 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-5">
              <div className="rounded-[24px] border border-white/8 bg-background p-4">
                <p className="text-xs font-mono uppercase tracking-[0.25em] text-muted">Ingrediente</p>
                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-white/85">
                  {nutritionProduct.nutritionInfo.ingredientsText}
                </p>
              </div>

              {nutritionProduct.nutritionInfo.allergenTraceText && (
                <div className="rounded-[24px] border border-danger/20 bg-danger/10 p-4">
                  <p className="text-xs font-mono uppercase tracking-[0.25em] text-danger">Alergeni</p>
                  <p className="mt-3 text-sm leading-6 text-white/85">
                    {nutritionProduct.nutritionInfo.allergenTraceText}
                  </p>
                </div>
              )}

              <div className="rounded-[24px] border border-white/8 bg-background p-4">
                <p className="text-xs font-mono uppercase tracking-[0.25em] text-muted">
                  {nutritionProduct.nutritionInfo.valuesHeading || 'Valori per 100 gr'}
                </p>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {nutritionProduct.nutritionInfo.valuesPer100g.map((entry) => (
                    <div key={entry.label} className="rounded-2xl border border-white/8 bg-card px-4 py-3">
                      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted">{entry.label}</p>
                      <p className="mt-2 text-base font-semibold text-white">{entry.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isCartOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center overscroll-none">
          <div className="absolute inset-0" onClick={() => setIsCartOpen(false)} />
          <div className="relative z-10 w-full max-w-[430px] h-[100dvh] max-h-[100dvh] rounded-t-[32px] bg-card border-t border-white/10 flex flex-col overflow-hidden sm:h-auto sm:max-h-[85dvh]">
            <div className="shrink-0 flex items-center justify-between border-b border-white/5 bg-card/95 backdrop-blur px-5 py-4">
              <h3 className="text-xl font-display font-bold">Cerere de comanda</h3>
              <button
                onClick={() => setIsCartOpen(false)}
                className="w-9 h-9 rounded-full bg-background border border-white/8 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 pb-6">
              <div className="rounded-2xl border border-white/8 bg-background p-4">
                <p className="text-xs font-mono uppercase tracking-[0.25em] text-muted">Masa</p>
                <p className="mt-2 text-sm text-white">Masa {activeTable.number}</p>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-white/8 bg-background p-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={item.product.imageUrl} alt={item.product.name} className="w-12 h-12 rounded-xl object-cover" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{item.product.name}</p>
                        <p className="text-xs text-muted">{formatCad(getLineUnitPrice(item.product, item.selectedOptions))} / buc</p>
                        {groupSelectedOptions(item.selectedOptions).length > 0 && (
                          <div className="mt-1 space-y-1">
                            {groupSelectedOptions(item.selectedOptions).map((group) => (
                              <p key={`${item.id}-${group.groupId}`} className="text-[11px] text-muted truncate">
                                {group.groupName}: {group.choices.map((choice) => choice.choiceName).join(', ')}
                              </p>
                            ))}
                          </div>
                        )}
                        {item.notes && <p className="text-xs text-primary truncate mt-1">{item.notes}</p>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateCartQuantity(item.id, -1)}
                        className="w-8 h-8 rounded-xl border border-white/8 flex items-center justify-center"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-7 text-center text-sm font-mono">{item.quantity}</span>
                      <button
                        onClick={() => updateCartQuantity(item.id, 1)}
                        className="w-8 h-8 rounded-xl border border-white/8 flex items-center justify-center"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <label className="text-xs font-mono uppercase tracking-[0.25em] text-muted">Nota generala</label>
                <textarea
                  value={additionalOrderNotes}
                  onChange={(event) => setAdditionalOrderNotes(event.target.value)}
                  onFocus={(event) => scrollFieldIntoView(event.currentTarget)}
                  placeholder="Ce ar trebui sa stie ospatarul sau bucataria..."
                  rows={4}
                  className="mt-2 w-full rounded-2xl border border-white/8 bg-background p-3 text-sm text-white outline-none resize-none"
                />
              </div>
            </div>

            <div className="shrink-0 border-t border-white/10 bg-card/95 backdrop-blur px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="rounded-2xl border border-white/8 bg-background p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Subtotal</span>
                  <span className="font-mono">{formatCad(cartTotal)}</span>
                </div>
                <p className="mt-3 text-xs text-muted leading-6">
                  {settings.customerOrderingEnabled
                    ? 'Cererea de comanda ajunge mai intai la ospatar pentru aprobare, apoi apare in panoul bucatariei.'
                    : 'Comenzile din telefon sunt oprite. Acest buton il cheama pe ospatar la masa cu cosul pregatit pe telefonul tau.'}
                </p>
                {waiterCallMarker && !settings.customerOrderingEnabled && (
                  <div className="mt-3 rounded-xl border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
                    Ospatarul a fost deja chemat pentru aceasta masa.
                  </div>
                )}
              </div>

              <button
                onClick={checkoutOrder}
                disabled={cart.length === 0}
                className="mt-4 w-full rounded-2xl bg-primary disabled:bg-muted/20 disabled:text-muted px-4 py-3 text-sm font-bold uppercase tracking-[0.2em]"
              >
                {settings.customerOrderingEnabled ? 'Trimite cererea de comanda' : 'Cheama ospatarul la masa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewOrder && (
        <div className="fixed inset-0 z-50 bg-background/95 flex items-center justify-center p-5">
          <div className="w-full max-w-[360px] rounded-[28px] border border-white/10 bg-card p-5 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
            <h3 className="mt-4 text-xl font-display font-bold">Preparatul a fost livrat</h3>
            <p className="mt-2 text-sm text-muted leading-6">
              Daca vrei, lasa o scurta recenzie pentru bucatarie si echipa de servire.
            </p>

            {isReviewSubmitted ? (
              <div className="mt-5 text-success text-sm font-semibold">Recenzie trimisa. Multumim.</div>
            ) : (
              <>
                <div className="mt-5 flex items-center justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button key={value} onClick={() => setReviewRating(value)}>
                      <Star
                        className={`w-7 h-7 ${value <= reviewRating ? 'fill-yellow-400 text-yellow-400' : 'text-muted'}`}
                      />
                    </button>
                  ))}
                </div>
                <input
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  placeholder="Spune-ne ce ti-a placut..."
                  className="mt-4 w-full rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm text-white outline-none"
                />
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setReviewOrder(null)}
                    className="flex-1 rounded-2xl border border-white/8 px-4 py-3 text-sm text-muted"
                  >
                    Sari peste
                  </button>
                  <button
                    onClick={submitReview}
                    className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold"
                  >
                    Trimite
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {feedbackPopup && (
        <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-5">
          <div className="relative w-full max-w-[360px] rounded-[28px] border border-white/10 bg-card p-5 text-center">
            <div
              className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${
                feedbackPopup.tone === 'success' ? 'bg-success/15' : 'bg-danger/15'
              }`}
            >
              {feedbackPopup.tone === 'success' ? (
                <Check className="w-7 h-7 text-success" />
              ) : (
                <X className="w-7 h-7 text-danger" />
              )}
            </div>
            <h3 className="mt-4 text-xl font-display font-bold">{feedbackPopup.title}</h3>
            <p className="mt-2 text-sm text-muted leading-6">{feedbackPopup.message}</p>
            <button
              onClick={() => setFeedbackPopup(null)}
              className="mt-5 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold"
            >
              Am inteles
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
