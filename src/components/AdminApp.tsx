import React, { useEffect, useMemo, useState } from 'react';
import { 
  ShieldAlert, TrendingUp, BarChart3, QrCode, FileSpreadsheet, Plus, Edit, Trash, Check, X, Shield, Coffee, Grid, Star 
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import { api } from '../services/api.js';
import { AccessControlSummary, Order, Review, Table, Category, Product, ProductOptionGroup, RestaurantSettings, SystemStats } from '../types.js';
import { formatCad, formatDateTime, generateQrSvg, getOrderSourceLabel, getOrderStatusLabel, getPaymentMethodLabel, getTableAreaLabel, getTableQrLabel } from '../utils.js';

type AnalyticsRange = 'today' | 'day' | 'week' | 'month';
type AnalyticsGroup = 'hour' | 'day' | 'week' | 'month';
type TableArea = 'INTERIOR' | 'TERASA';
type AdminToast = {
  tone: 'success' | 'error';
  message: string;
} | null;
type AdminConfirmDialog = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
} | null;

const monthLabels = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];
const categoryIconOptions = [
  { icon: '🍕', label: 'Pizza' },
  { icon: '🍔', label: 'Burger' },
  { icon: '🍝', label: 'Paste' },
  { icon: '🍗', label: 'Grill' },
  { icon: '🥗', label: 'Salata' },
  { icon: '🍲', label: 'Ciorba' },
  { icon: '🍣', label: 'Sushi' },
  { icon: '🌮', label: 'Street food' },
  { icon: '🍰', label: 'Desert' },
  { icon: '☕', label: 'Cafea' },
  { icon: '🍹', label: 'Cocktail' },
  { icon: '🥤', label: 'Racoritoare' },
  { icon: '🍷', label: 'Vin' },
  { icon: '🍺', label: 'Bere' },
  { icon: '🥃', label: 'Tarie' },
  { icon: '💨', label: 'Narghilea' },
  { icon: '🍽️', label: 'Meniu' },
  { icon: '🧃', label: 'Suc' },
];

function createEmptyNutritionInfo() {
  return {
    ingredientsText: '',
    allergenTraceText: '',
    valuesHeading: 'Valoare energetica pentru 100 gr',
    valuesPer100g: [],
  };
}

function createEmptyOptionChoice() {
  return {
    id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    priceDelta: 0,
  };
}

function createEmptyOptionGroup(): ProductOptionGroup {
  return {
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    required: false,
    selectionType: 'single',
    maxSelections: 2,
    choices: [createEmptyOptionChoice()],
  };
}

function serializeNutritionValues(values: { label: string; value: string }[]) {
  return values.map((entry) => `${entry.label} - ${entry.value}`).join('\n');
}

function parseNutritionValues(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*[-:]\s*/);
      if (parts.length < 2) {
        return null;
      }

      const [label, ...valueParts] = parts;
      return {
        label: label.trim(),
        value: valueParts.join(' - ').trim(),
      };
    })
    .filter(Boolean) as { label: string; value: string }[];
}

function getStartOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getStartOfWeek(date: Date) {
  const next = getStartOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function getStartOfMonth(date: Date) {
  const next = getStartOfDay(date);
  next.setDate(1);
  return next;
}

function getAnalyticsRangeStart(range: AnalyticsRange, now: Date) {
  switch (range) {
    case 'today':
      return getStartOfDay(now);
    case 'day': {
      const next = new Date(now);
      next.setTime(next.getTime() - 24 * 60 * 60 * 1000);
      return next;
    }
    case 'week':
      return getStartOfWeek(now);
    case 'month':
      return getStartOfMonth(now);
    default:
      return getStartOfDay(now);
  }
}

function getWeekNumber(date: Date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getGroupedLabel(date: Date, group: AnalyticsGroup) {
  switch (group) {
    case 'hour':
      return `${String(date.getHours()).padStart(2, '0')}:00`;
    case 'day':
      return `${String(date.getDate()).padStart(2, '0')} ${monthLabels[date.getMonth()]}`;
    case 'week':
      return `Sapt. ${getWeekNumber(date)} / ${date.getFullYear()}`;
    case 'month':
      return `${monthLabels[date.getMonth()]} ${date.getFullYear()}`;
    default:
      return `${String(date.getDate()).padStart(2, '0')} ${monthLabels[date.getMonth()]}`;
  }
}

function getGroupedSortKey(date: Date, group: AnalyticsGroup) {
  switch (group) {
    case 'hour':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime();
    case 'day':
      return getStartOfDay(date).getTime();
    case 'week':
      return getStartOfWeek(date).getTime();
    case 'month':
      return getStartOfMonth(date).getTime();
    default:
      return getStartOfDay(date).getTime();
  }
}

function getKitchenDurationMinutes(order: Order) {
  if (!order.startedAt || !order.completedAt) {
    return null;
  }

  const startedAt = new Date(order.startedAt).getTime();
  const completedAt = new Date(order.completedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    return null;
  }

  return (completedAt - startedAt) / 60000;
}

function formatKitchenDuration(minutes: number | null) {
  if (minutes === null) {
    return '-';
  }

  if (minutes < 60) {
    return `${minutes.toFixed(1)} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes.toFixed(0)} min`;
}

export default function AdminApp({ onLogout }: { onLogout?: () => void | Promise<void> }) {
  const [stats, setStats] = useState<SystemStats>({
    revenueToday: 0,
    revenueThisWeek: 0,
    revenueThisMonth: 0,
    activeOrders: 0,
    activeTablesCount: 0,
    avgOrderValue: 0,
    avgKitchenTimeMinutes: 0,
    mostSoldProduct: null,
    bestRatedProduct: null
  });
  
  const [tables, setTables] = useState<Table[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings>({ customerOrderingEnabled: true });
  const [accessControl, setAccessControl] = useState<AccessControlSummary>({
    adminUsername: 'admin',
    adminPasswordConfigured: true,
    waiterPinConfigured: true,
    kitchenPinConfigured: true,
  });
  const [adminUsernameInput, setAdminUsernameInput] = useState('admin');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [waiterPinInput, setWaiterPinInput] = useState('');
  const [kitchenPinInput, setKitchenPinInput] = useState('');
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>('today');
  const [analyticsGroup, setAnalyticsGroup] = useState<AnalyticsGroup>('hour');
  const [newTableArea, setNewTableArea] = useState<TableArea>('INTERIOR');
  const [newTableCount, setNewTableCount] = useState(1);
  const [toast, setToast] = useState<AdminToast>(null);
  const [confirmDialog, setConfirmDialog] = useState<AdminConfirmDialog>(null);
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);

  // Sub-navigation tabs
  const [activeTab, setActiveTab] = useState<'analytics' | 'menu' | 'qr' | 'reviews' | 'settings'>('analytics');

  // Menu Creation/Editing form states
  const [isEditingProduct, setIsEditingProduct] = useState<string | null>(null); // 'new' or id
  const [productForm, setProductForm] = useState<Omit<Product, 'id'>>({
    name: '',
    description: '',
    price: 0,
    imageUrl: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80',
    rating: 5.0,
    reviewsCount: 1,
    prepTime: 10,
    isBestseller: false,
    categoryId: '',
    available: true,
    allergens: [],
    nutritionInfo: createEmptyNutritionInfo(),
    optionGroups: [],
  });
  const [productPriceInput, setProductPriceInput] = useState('');
  const [nutritionValuesText, setNutritionValuesText] = useState('');

  const [isEditingCategory, setIsEditingCategory] = useState<string | null>(null); // 'new' or id
  const [categoryForm, setCategoryForm] = useState({ name: '', icon: '🍕' });

  // Get current base url for QR generator
  const getAppBaseUrl = () => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return 'https://restaurant.com';
  };

  const showToast = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
  };

  useEffect(() => {
    setAdminUsernameInput(accessControl.adminUsername || 'admin');
  }, [accessControl.adminUsername]);

  const openConfirmDialog = (dialog: NonNullable<AdminConfirmDialog>) => {
    setConfirmDialog(dialog);
  };

  const refreshStats = async () => {
    try {
      const nextStats = await api.getStats();
      setStats(nextStats);
    } catch (error) {
      console.error('Nu am putut actualiza indicatorii', error);
    }
  };

  const upsertTable = (incoming: Table) => {
    setTables((current) => {
      const index = current.findIndex((table) => table.id === incoming.id);
      if (index === -1) {
        return [...current, incoming].sort((left, right) => left.number - right.number);
      }

      const next = [...current];
      next[index] = incoming;
      return next.sort((left, right) => left.number - right.number);
    });
  };

  const upsertCategory = (incoming: Category) => {
    setCategories((current) => {
      const index = current.findIndex((category) => category.id === incoming.id);
      if (index === -1) {
        return [...current, incoming].sort((left, right) => left.name.localeCompare(right.name));
      }

      const next = [...current];
      next[index] = incoming;
      return next.sort((left, right) => left.name.localeCompare(right.name));
    });
  };

  const upsertProduct = (incoming: Product) => {
    setProducts((current) => {
      const index = current.findIndex((product) => product.id === incoming.id);
      if (index === -1) {
        return [...current, incoming].sort((left, right) => left.name.localeCompare(right.name));
      }

      const next = [...current];
      next[index] = incoming;
      return next.sort((left, right) => left.name.localeCompare(right.name));
    });
  };

  const upsertOrder = (incoming: Order) => {
    setOrders((current) => {
      const index = current.findIndex((order) => order.id === incoming.id);
      if (index === -1) {
        return [incoming, ...current].sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        );
      }

      const next = [...current];
      next[index] = incoming;
      return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    });
  };

  const upsertReview = (incoming: Review) => {
    setReviews((current) => {
      const index = current.findIndex((review) => review.id === incoming.id);
      if (index === -1) {
        return [incoming, ...current].sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        );
      }

      const next = [...current];
      next[index] = incoming;
      return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    });
  };

  const loadAdminDb = async () => {
    try {
      const [st, tb, ct, pr, od, rv, sg] = await Promise.all([
        api.getStats(),
        api.getTables(),
        api.getCategories(),
        api.getProducts(),
        api.getOrders(),
        api.getReviews(),
        api.getSettings()
      ]);
      setStats(st);
      setTables(tb);
      setCategories(ct);
      setProducts(pr);
      setOrders(od);
      setReviews(rv);
      setSettings(sg);
      const accessSummary = await api.getAccessControlSummary();
      setAccessControl(accessSummary);

      // Default category id if empty
      if (ct.length > 0 && !productForm.categoryId) {
        setProductForm(prev => ({ ...prev, categoryId: ct[0].id }));
      }
    } catch (e) {
      console.error('Nu am putut incarca datele din panoul de admin', e);
    }
  };

  useEffect(() => {
    loadAdminDb();

    const unsubOrder = api.subscribe('new-order', (order: Order) => {
      upsertOrder(order);
      refreshStats();
    });
    const unsubOrderRequest = api.subscribe('new-order-request', (order: Order) => {
      upsertOrder(order);
      refreshStats();
    });
    const unsubOrderUpdate = api.subscribe('order-update', (order: Order) => {
      upsertOrder(order);
      refreshStats();
    });
    const unsubTable = api.subscribe('table-update', (table: Table) => {
      upsertTable(table);
      refreshStats();
    });
    const unsubTableDelete = api.subscribe('table-delete', ({ id }: { id: string }) => {
      setTables((current) => current.filter((table) => table.id !== id));
      refreshStats();
    });
    const unsubMenu = api.subscribe('menu-update', (payload: any) => {
      if (payload?.type === 'category_created' && payload.category) {
        upsertCategory(payload.category);
      } else if (payload?.type === 'category_updated' && payload.category) {
        upsertCategory(payload.category);
      } else if (payload?.type === 'category_deleted' && payload.id) {
        setCategories((current) => current.filter((entry) => entry.id !== payload.id));
      } else if (payload?.type === 'product_created' && payload.product) {
        upsertProduct(payload.product);
      } else if (payload?.type === 'product_updated' && payload.product) {
        upsertProduct(payload.product);
      } else if (payload?.type === 'product_deleted' && payload.id) {
        setProducts((current) => current.filter((entry) => entry.id !== payload.id));
      }
    });
    const unsubSettings = api.subscribe('settings-update', (nextSettings: RestaurantSettings) => {
      setSettings(nextSettings);
    });
    const unsubReview = api.subscribe('new-review', (review: Review) => {
      upsertReview(review);
    });

    return () => {
      unsubOrder();
      unsubOrderRequest();
      unsubOrderUpdate();
      unsubTable();
      unsubTableDelete();
      unsubMenu();
      unsubSettings();
      unsubReview();
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!confirmDialog) {
      setIsConfirmingAction(false);
    }
  }, [confirmDialog]);

  useEffect(() => {
    if (!categories.length) {
      return;
    }

    setProductForm((current) => {
      if (current.categoryId && categories.some((category) => category.id === current.categoryId)) {
        return current;
      }

      return { ...current, categoryId: categories[0].id };
    });
  }, [categories]);

  useEffect(() => {
    setNutritionValuesText(serializeNutritionValues(productForm.nutritionInfo?.valuesPer100g || []));
  }, [productForm.nutritionInfo]);

  useEffect(() => {
    if (!categoryForm.icon || categoryForm.icon.includes('ðŸ')) {
      setCategoryForm((current) => ({ ...current, icon: '🍕' }));
    }
  }, [categoryForm.icon]);

  // Category Actions
  const handleSaveCategory = async () => {
    if (!categoryForm.name) return;
    try {
      if (isEditingCategory === 'new') {
        const createdCategory = await api.createCategory(categoryForm.name, categoryForm.icon);
        upsertCategory(createdCategory);
        showToast('Categoria a fost adaugata.');
      } else if (isEditingCategory) {
        const updatedCategory = await api.updateCategory(isEditingCategory, categoryForm.name, categoryForm.icon, true);
        upsertCategory(updatedCategory);
        showToast('Categoria a fost actualizata.');
      }
      setIsEditingCategory(null);
      setCategoryForm({ name: '', icon: '🍕' });
    } catch (err) {
      console.error(err);
      showToast('Nu am putut salva categoria.', 'error');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    openConfirmDialog({
      title: 'Esti sigur ca vrei sa stergi categoria?',
      message: 'Toate produsele asociate vor pierde legatura cu aceasta categorie.',
      confirmLabel: 'Sterge categoria',
      onConfirm: async () => {
        try {
          await api.deleteCategory(id);
          setCategories((current) => current.filter((entry) => entry.id !== id));
          showToast('Categoria a fost stearsa.');
        } catch (err) {
          console.error(err);
          showToast('Nu am putut sterge categoria.', 'error');
        }
      },
    });
  };

  const addOptionGroupToProduct = () => {
    setProductForm((prev) => ({
      ...prev,
      optionGroups: [...(prev.optionGroups || []), createEmptyOptionGroup()],
    }));
  };

  const updateOptionGroup = (groupId: string, updater: (group: ProductOptionGroup) => ProductOptionGroup) => {
    setProductForm((prev) => ({
      ...prev,
      optionGroups: (prev.optionGroups || []).map((group) => (group.id === groupId ? updater(group) : group)),
    }));
  };

  const removeOptionGroup = (groupId: string) => {
    setProductForm((prev) => ({
      ...prev,
      optionGroups: (prev.optionGroups || []).filter((group) => group.id !== groupId),
    }));
  };

  const addOptionChoice = (groupId: string) => {
    updateOptionGroup(groupId, (group) => ({
      ...group,
      choices: [...group.choices, createEmptyOptionChoice()],
    }));
  };

  const removeOptionChoice = (groupId: string, choiceId: string) => {
    updateOptionGroup(groupId, (group) => ({
      ...group,
      choices: group.choices.filter((choice) => choice.id !== choiceId),
    }));
  };

  // Product Actions
  const handleSaveProduct = async () => {
    const normalizedPrice = Number(productPriceInput.replace(',', '.'));
    if (!productForm.name || !productForm.categoryId) return;
    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      showToast('Introdu un pret valid in lei.', 'error');
      return;
    }
    const normalizedNutritionInfo = productForm.nutritionInfo
      ? {
          ingredientsText: productForm.nutritionInfo.ingredientsText.trim(),
          allergenTraceText: productForm.nutritionInfo.allergenTraceText?.trim() || '',
          valuesHeading: productForm.nutritionInfo.valuesHeading?.trim() || 'Valoare energetica pentru 100 gr',
          valuesPer100g: parseNutritionValues(nutritionValuesText),
        }
      : createEmptyNutritionInfo();

    const hasNutritionContent = Boolean(
      normalizedNutritionInfo.ingredientsText ||
        normalizedNutritionInfo.allergenTraceText ||
        normalizedNutritionInfo.valuesPer100g.length
    );
    const normalizedOptionGroups = (productForm.optionGroups || [])
      .map((group) => ({
        ...group,
        name: group.name.trim(),
        maxSelections:
          group.selectionType === 'multiple' && Number(group.maxSelections || 0) > 0
            ? Number(group.maxSelections)
            : undefined,
        choices: group.choices
          .map((choice) => ({
            ...choice,
            name: choice.name.trim(),
            priceDelta: Number(choice.priceDelta || 0),
          }))
          .filter((choice) => choice.name),
      }))
      .filter((group) => group.name && group.choices.length > 0);
    const productPayload: Omit<Product, 'id'> = {
      ...productForm,
      price: normalizedPrice,
      nutritionInfo: hasNutritionContent ? normalizedNutritionInfo : undefined,
      optionGroups: normalizedOptionGroups,
    };

    try {
      if (isEditingProduct === 'new') {
        const createdProduct = await api.createProduct(productPayload);
        upsertProduct(createdProduct);
        showToast('Produsul a fost adaugat.');
      } else if (isEditingProduct) {
        const updatedProduct = await api.updateProduct(isEditingProduct, productPayload);
        upsertProduct(updatedProduct);
        showToast('Produsul a fost actualizat.');
      }
      setIsEditingProduct(null);
    } catch (err) {
      console.error(err);
      showToast('Nu am putut salva produsul.', 'error');
    }
  };

  const handleDeleteProduct = async (id: string) => {
    openConfirmDialog({
      title: 'Esti sigur ca vrei sa stergi produsul?',
      message: 'Produsul va fi eliminat din meniu si nu va mai putea fi comandat.',
      confirmLabel: 'Sterge produsul',
      onConfirm: async () => {
        try {
          await api.deleteProduct(id);
          setProducts((current) => current.filter((entry) => entry.id !== id));
          showToast('Produsul a fost sters.');
        } catch (err) {
          console.error(err);
          showToast('Nu am putut sterge produsul.', 'error');
        }
      },
    });
  };

  const handleAddNewTable = async () => {
    const count = Math.max(1, Number(newTableCount || 1));
    const sortedNumbers = [...tables].map((table) => table.number).sort((a, b) => a - b);
    let nextNumber = sortedNumbers.length ? sortedNumbers[sortedNumbers.length - 1] + 1 : 1;

    try {
      const createdTables: Table[] = [];
      for (let index = 0; index < count; index += 1) {
        const areaIndex =
          tables.filter((table) => (table.area || 'INTERIOR') === newTableArea).length + index + 1;
        const generatedName = `${getTableAreaLabel(newTableArea)} ${areaIndex}`;
        const createdTable = await api.createTable(nextNumber, newTableArea, generatedName);
        createdTables.push(createdTable);
        nextNumber += 1;
      }

      createdTables.forEach((table) => upsertTable(table));
      refreshStats();
      showToast(
        count === 1
          ? `Masa a fost adaugata in ${getTableAreaLabel(newTableArea)}.`
          : `${count} mese au fost adaugate in ${getTableAreaLabel(newTableArea)}.`
      );
      setNewTableCount(1);
    } catch (err) {
      showToast('Nu am putut crea masa noua.', 'error');
    }
  };

  const handleDeleteTable = async (tableId: string, tableLabel: string) => {
    openConfirmDialog({
      title: `Esti sigur ca vrei sa stergi ${tableLabel}?`,
      message: 'Masa va fi eliminata din admin si nu va mai avea cod QR activ.',
      confirmLabel: 'Sterge masa',
      onConfirm: async () => {
        try {
          await api.deleteTable(tableId);
          setTables((current) => current.filter((table) => table.id !== tableId));
          refreshStats();
          showToast(`${tableLabel} a fost stearsa.`);
        } catch (error) {
          console.error(error);
          showToast(error instanceof Error ? error.message : 'Nu am putut sterge masa.', 'error');
        }
      },
    });
  };

  const toggleCustomerOrdering = async () => {
    const nextValue = !settings.customerOrderingEnabled;
    try {
      const nextSettings = await api.updateSettings({ customerOrderingEnabled: nextValue });
      setSettings(nextSettings);
      showToast(
        nextSettings.customerOrderingEnabled
          ? 'Comanda din telefon a fost pornita.'
          : 'Comanda din telefon a fost oprita. Ramane disponibila doar comanda manuala a ospatarului.'
      );
    } catch (error) {
      console.error(error);
      showToast('Nu am putut actualiza setarea de comanda client.', 'error');
    }
  };

  const saveWaiterPin = async () => {
    const normalizedPin = waiterPinInput.replace(/\D/g, '').slice(0, 4);
    if (normalizedPin.length !== 4) {
      showToast('PIN-ul ospatarului trebuie sa aiba exact 4 cifre.', 'error');
      return;
    }

    try {
      const nextAccessControl = await api.updateAccessControl({ waiterPin: normalizedPin });
      setAccessControl(nextAccessControl);
      setWaiterPinInput('');
      showToast('PIN-ul ospatarului a fost actualizat in siguranta.');
    } catch (error) {
      console.error('Nu am putut actualiza PIN-ul ospatarului', error);
      showToast('Nu am putut salva PIN-ul ospatarului.', 'error');
    }
  };

  const saveKitchenPin = async () => {
    const normalizedPin = kitchenPinInput.replace(/\D/g, '').slice(0, 4);
    if (normalizedPin.length !== 4) {
      showToast('PIN-ul bucatariei trebuie sa aiba exact 4 cifre.', 'error');
      return;
    }

    try {
      const nextAccessControl = await api.updateAccessControl({ kitchenPin: normalizedPin });
      setAccessControl(nextAccessControl);
      setKitchenPinInput('');
      showToast('PIN-ul bucatariei a fost actualizat.');
    } catch (error) {
      console.error('Nu am putut actualiza PIN-ul bucatariei', error);
      showToast('Nu am putut salva PIN-ul bucatariei.', 'error');
    }
  };

  const saveAdminCredentials = async () => {
    const normalizedUsername = adminUsernameInput.trim();
    if (!normalizedUsername) {
      showToast('Introdu un username valid pentru admin.', 'error');
      return;
    }

    if (adminPasswordInput && adminPasswordInput.trim().length < 6) {
      showToast('Parola de admin trebuie sa aiba minim 6 caractere.', 'error');
      return;
    }

    try {
      const nextAccessControl = await api.updateAccessControl({
        adminUsername: normalizedUsername,
        ...(adminPasswordInput.trim() ? { adminPassword: adminPasswordInput } : {}),
      });
      setAccessControl(nextAccessControl);
      setAdminPasswordInput('');
      showToast('Credentialele de admin au fost actualizate.');
    } catch (error) {
      console.error('Nu am putut actualiza credentialele de admin', error);
      showToast('Nu am putut salva credentialele de admin.', 'error');
    }
  };

  // Printable QR utilities
  const downloadQrSvg = (table: Table) => {
    const qrLabel = getTableQrLabel(table);
    const { svgMarkup } = generateQrSvg(table.number, getAppBaseUrl(), qrLabel);
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const trigger = document.createElement('a');
    trigger.href = url;
    trigger.download = `ristorante_milano_table_${qrLabel.toLowerCase()}.svg`;
    document.body.appendChild(trigger);
    trigger.click();
    document.body.removeChild(trigger);
    URL.revokeObjectURL(url);
  };

  const downloadQrPng = async (table: Table) => {
    const qrLabel = getTableQrLabel(table);
    const { svgMarkup } = generateQrSvg(table.number, getAppBaseUrl(), qrLabel);
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const image = new Image();
      image.decoding = 'async';

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Nu am putut incarca SVG-ul pentru conversia PNG.'));
        image.src = svgUrl;
      });

      const canvas = document.createElement('canvas');
      const exportSize = 1024;
      canvas.width = exportSize;
      canvas.height = exportSize;

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas-ul pentru export PNG nu este disponibil.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, exportSize, exportSize);
      context.drawImage(image, 0, 0, exportSize, exportSize);

      const pngUrl = canvas.toDataURL('image/png');
      const trigger = document.createElement('a');
      trigger.href = pngUrl;
      trigger.download = `ristorante_milano_table_${qrLabel.toLowerCase()}.png`;
      document.body.appendChild(trigger);
      trigger.click();
      document.body.removeChild(trigger);
    } catch (error) {
      console.error('Nu am putut descarca PNG-ul pentru QR', error);
      showToast('Nu am putut genera PNG-ul pentru acest QR.', 'error');
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };

  const printQrCode = (table: Table) => {
    const qrLabel = getTableQrLabel(table);
    const { svgMarkup, targetUrl } = generateQrSvg(table.number, getAppBaseUrl(), qrLabel);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Card QR masa ${qrLabel}</title>
            <style>
              body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background:#FFFFFF; margin:0; }
              .card { border: 2px solid #000000; border-radius: 20px; padding: 40px; text-align: center; max-width: 320px; }
              h1 { font-size: 24px; color: #c9a84c; margin-top:0; }
              p { color: #555555; font-size: 14px; margin: 10px 0 20px 0; }
              .badge { display: inline-block; background: #000; color: #fff; padding: 6px 12px; border-radius: 5px; font-weight: bold; font-family: monospace; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Ristorante Milano</h1>
              <p>Scaneaza codul de mai jos pentru a deschide instant meniul digital al restaurantului si pentru a comanda direct de pe ecran.</p>
              <div style="width:250px; height:250px; margin:0 auto;">${svgMarkup}</div>
              <p style="font-size:11px; margin-top:15px; color:#999;">${targetUrl}</p>
              <div class="badge">${qrLabel}</div>
            </div>
            <script>
              window.onload = function() { window.print(); window.close(); }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  // Recharts Chart Dataset Setup
  const revenueChartData = [
    { day: 'Lun', revenue: stats.revenueThisWeek * 0.12 },
    { day: 'Mar', revenue: stats.revenueThisWeek * 0.15 },
    { day: 'Mie', revenue: stats.revenueThisWeek * 0.11 },
    { day: 'Joi', revenue: stats.revenueThisWeek * 0.13 },
    { day: 'Vin', revenue: stats.revenueThisWeek * 0.18 + 50 },
    { day: 'Sam', revenue: stats.revenueThisWeek * 0.22 + 90 },
    { day: 'Dum', revenue: stats.revenueToday } // ziua curenta
  ].map(item => ({ ...item, revenue: parseFloat((item.revenue || 0).toFixed(2)) }));

  const analyticsRangeOptions: { id: AnalyticsRange; label: string }[] = [
    { id: 'today', label: 'Ziua curenta' },
    { id: 'day', label: 'Ultimele 24h' },
    { id: 'week', label: 'Saptamana curenta' },
    { id: 'month', label: 'Luna curenta' },
  ];
  const analyticsGroupOptions: { id: AnalyticsGroup; label: string }[] = [
    { id: 'hour', label: 'Pe ora' },
    { id: 'day', label: 'Pe zi' },
    { id: 'week', label: 'Pe saptamana' },
    { id: 'month', label: 'Pe luna' },
  ];

  const filteredAnalyticsOrders = useMemo(() => {
    const now = new Date();
    const rangeStart = getAnalyticsRangeStart(analyticsRange, now).getTime();

    return [...orders]
      .filter((order) => {
        const createdAt = new Date(order.createdAt).getTime();
        return createdAt >= rangeStart && createdAt <= now.getTime();
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [analyticsRange, orders]);

  const groupedAnalyticsOrders = useMemo(() => {
    const groups = new Map<string, {
      id: string;
      label: string;
      sortKey: number;
      ordersCount: number;
      revenue: number;
      itemsCount: number;
      tables: Set<number>;
    }>();

    filteredAnalyticsOrders.forEach((order) => {
      const createdAt = new Date(order.createdAt);
      const id = `${analyticsGroup}-${getGroupedSortKey(createdAt, analyticsGroup)}`;
      const existing = groups.get(id) || {
        id,
        label: getGroupedLabel(createdAt, analyticsGroup),
        sortKey: getGroupedSortKey(createdAt, analyticsGroup),
        ordersCount: 0,
        revenue: 0,
        itemsCount: 0,
        tables: new Set<number>(),
      };

      existing.ordersCount += 1;
      existing.revenue += order.subtotal;
      existing.itemsCount += order.items.reduce((sum, item) => sum + item.quantity, 0);
      existing.tables.add(order.tableNumber);
      groups.set(id, existing);
    });

    return [...groups.values()]
      .sort((a, b) => b.sortKey - a.sortKey)
      .map((entry) => ({
        ...entry,
        tablesLabel: [...entry.tables].sort((a, b) => a - b).map((table) => `M${table}`).join(', '),
      }));
  }, [analyticsGroup, filteredAnalyticsOrders]);

  const analyticsTotals = useMemo(() => {
    const cancelledCount = filteredAnalyticsOrders.filter((order) => order.status === 'CANCELLED').length;
    const totalRevenue = filteredAnalyticsOrders.reduce((sum, order) => sum + order.subtotal, 0);
    const totalItems = filteredAnalyticsOrders.reduce(
      (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0
    );

    return {
      totalOrders: filteredAnalyticsOrders.length,
      cancelledCount,
      totalRevenue,
      totalItems,
      averageOrderValue: filteredAnalyticsOrders.length ? totalRevenue / filteredAnalyticsOrders.length : 0,
    };
  }, [filteredAnalyticsOrders]);

  const kitchenPerformanceOrders = useMemo(
    () =>
      [...orders]
        .filter((order) => order.startedAt)
        .sort((left, right) => {
          const rightTime = new Date(right.completedAt || right.updatedAt).getTime();
          const leftTime = new Date(left.completedAt || left.updatedAt).getTime();
          return rightTime - leftTime;
        }),
    [orders]
  );
  const renderReviewsSection = () => (
    <section className="bg-card border border-white/5 rounded-[24px] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-display font-bold text-white uppercase tracking-wider">Recenzii clienti</h3>
          <p className="text-xs text-muted font-mono mt-1">Feedback-ul trimis din telefon apare aici si ramane salvat pentru admin.</p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-primary">
          {reviews.length} total
        </span>
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-[20px] border border-white/8 bg-background px-4 py-8 text-center text-sm text-muted">
          Nu exista inca recenzii trimise de clienti.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {reviews.map((review) => (
            <div key={review.id} className="rounded-[20px] border border-white/8 bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-display font-bold text-white truncate">
                    {review.productName || 'Recenzie generala'}
                  </p>
                  <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                    {review.customerName || 'Client anonim'} • {formatDateTime(review.createdAt)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-warning/20 bg-warning/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-warning">
                  {review.rating}/5 stele
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/80">
                {review.comment?.trim() || 'Clientul a trimis doar rating, fara comentariu.'}
              </p>
              <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">
                Comanda {review.orderId}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const groupedTablesByArea = useMemo(() => {
    const groups = new Map<string, Table[]>();

    tables.forEach((table) => {
      const area = table.area || 'INTERIOR';
      const current = groups.get(area) || [];
      current.push(table);
      groups.set(area, current);
    });

    return [...groups.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([area, areaTables]) => ({
        area,
        label: getTableAreaLabel(area),
        tables: [...areaTables].sort((left, right) => left.number - right.number),
      }));
  }, [tables]);

  return (
    <div className="w-full min-h-screen bg-transparent p-4 md:p-6 text-white font-sans">
      {toast && (
        <div className="fixed top-5 right-5 z-[80] max-w-sm">
          <div
            className={`rounded-[22px] border px-4 py-3 shadow-2xl backdrop-blur ${
              toast.tone === 'success'
                ? 'bg-success/15 border-success/25 text-white'
                : 'bg-danger/15 border-danger/25 text-white'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  toast.tone === 'success' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
                }`}
              >
                {toast.tone === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.25em] text-white/70">
                  {toast.tone === 'success' ? 'Actualizare salvata' : 'Actiune esuata'}
                </p>
                <p className="mt-1 text-sm font-semibold leading-6">{toast.message}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
          <div className="absolute inset-0" onClick={() => !isConfirmingAction && setConfirmDialog(null)} />
          <div className="relative w-full max-w-md rounded-[28px] border border-white/10 bg-card p-6 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/15 text-danger">
              <Trash className="w-6 h-6" />
            </div>

            <div className="mt-5 text-center">
              <p className="text-xs font-mono uppercase tracking-[0.3em] text-danger">Confirmare</p>
              <h3 className="mt-3 text-2xl font-display font-bold text-white">{confirmDialog.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted">{confirmDialog.message}</p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                disabled={isConfirmingAction}
                className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-muted hover:text-white disabled:opacity-50"
              >
                Renunta
              </button>
              <button
                onClick={async () => {
                  if (!confirmDialog) {
                    return;
                  }

                  setIsConfirmingAction(true);
                  try {
                    await confirmDialog.onConfirm();
                  } finally {
                    setIsConfirmingAction(false);
                    setConfirmDialog(null);
                  }
                }}
                disabled={isConfirmingAction}
                className="rounded-2xl bg-danger px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isConfirmingAction ? 'Se sterge...' : confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Brand header panel */}
      <header className="mb-6 flex flex-col gap-4">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 bg-card rounded-2xl flex items-center justify-center border border-white/5">
        <ShieldAlert className="w-6 h-6 text-primary" />
      </div>
      <div>
        <h1 className="text-xl font-display font-bold text-white tracking-tight">Analize si administrare restaurant</h1>
        <span className="text-xs font-mono text-muted uppercase">Control central pentru meniu, mese si coduri QR</span>
      </div>
    </div>
    <button
      onClick={() => void onLogout?.()}
      className="rounded-2xl border border-white/8 bg-card px-4 py-2.5 text-sm font-semibold text-white"
    >
      Iesi
    </button>
  </div>

  {/* Dashboard Sub-Tabs navigation switcher */}
  <div className="flex bg-[#171A21] border border-white/5 p-1 rounded-xl w-full md:w-fit overflow-x-auto scrollbar-none">
    {[
      { id: 'analytics', label: 'Indicatori', icon: BarChart3 },
      { id: 'menu', label: 'Produse si categorii', icon: Grid },
      { id: 'qr', label: 'Generator QR', icon: QrCode },
      { id: 'reviews', label: 'Feedback clienti', icon: Star },
      { id: 'settings', label: 'Configurare meniu', icon: Shield }
    ].map(tab => {
      const Icon = tab.icon;
      const active = activeTab === tab.id;
      return (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id as any)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold cursor-pointer transition-all whitespace-nowrap flex-1 md:flex-none justify-center ${
            active 
              ? 'bg-primary text-white shadow-md shadow-primary/10' 
              : 'text-muted hover:text-white'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {tab.label}
        </button>
      );
    })}
  </div>
</header>

      {/* RENDER ACTIVE TAB */}
      {activeTab === 'analytics' && (
        <div className="flex flex-col gap-6">
          {/* KPI METRIC BENTO GRIDS */}
          <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            
            <div className="bg-card border border-white/5 p-4 rounded-[20px] shadow-sm flex flex-col justify-between h-28 col-span-1 md:col-span-2">
              <span className="text-[10px] font-mono text-muted uppercase tracking-wider block">Venit astazi</span>
              <div>
                <span className="text-2xl font-display font-extrabold text-white leading-none tracking-tight block">
                  {formatCad(stats.revenueToday)}
                </span>
                <span className="text-[10px] text-success font-mono font-semibold block mt-1">+14% fata de ieri</span>
              </div>
            </div>

            <div className="bg-card border border-white/5 p-4 rounded-[20px] shadow-sm flex flex-col justify-between h-28 col-span-1 md:col-span-2">
              <span className="text-[10px] font-mono text-muted uppercase tracking-wider block">Venit saptamanal</span>
              <div>
                <span className="text-2xl font-display font-extrabold text-secondary leading-none tracking-tight block">
                  {formatCad(stats.revenueThisWeek)}
                </span>
                <span className="text-[10px] text-success font-mono font-semibold block mt-1">+8.2% fata de saptamana trecuta</span>
              </div>
            </div>

            <div className="bg-card border border-gradient p-4 rounded-[20px] border-primary/20 shadow-md flex flex-col justify-between h-28 col-span-2">
              <span className="text-[10px] font-mono text-primary uppercase tracking-widest font-bold block">Vanzari lunare brute</span>
              <div>
                <span className="text-3xl font-display font-extrabold text-white leading-none tracking-tight block">
                  {formatCad(stats.revenueThisMonth)}
                </span>
                <span className="text-[10px] text-primary font-mono font-bold block mt-1">Obiectiv: 15k EUR</span>
              </div>
            </div>

            <div className="bg-card border border-white/5 p-4 rounded-[20px] flex flex-col justify-between h-28 col-span-1">
              <span className="text-[10px] font-mono text-muted uppercase tracking-wider block">Bon mediu</span>
              <div>
                <span className="text-xl font-display font-bold text-white font-mono">{formatCad(stats.avgOrderValue)}</span>
                <span className="text-[9px] text-muted block mt-1">Per tranzactie</span>
              </div>
            </div>

            <div className="bg-card border border-white/5 p-4 rounded-[20px] flex flex-col justify-between h-28 col-span-1">
              <span className="text-[10px] font-mono text-muted uppercase tracking-wider block">Mese active</span>
              <div>
                <span className="text-xl font-display font-bold text-success font-mono">{stats.activeTablesCount} mese</span>
                <span className="text-[9px] text-muted block mt-1">Cu scanare QR activa</span>
              </div>
            </div>

            <div className="bg-card border border-white/5 p-4 rounded-[20px] flex flex-col justify-between h-28 col-span-1 md:col-span-2">
              <span className="text-[10px] font-mono text-muted uppercase tracking-wider block">Timp mediu bucatarie</span>
              <div>
                <span className="text-2xl font-display font-bold text-warning font-mono">
                  {formatKitchenDuration(stats.avgKitchenTimeMinutes)}
                </span>
                <span className="text-[9px] text-muted block mt-1">Din momentul in care porneste gatirea pana la livrare</span>
              </div>
            </div>

            <div className="bg-card border border-white/5 p-4 rounded-[20px] flex flex-col justify-between h-28 col-span-2">
              <span className="text-[10px] font-mono text-muted uppercase tracking-wider block">Cel mai vandut produs</span>
              {stats.mostSoldProduct ? (
                <div className="flex items-center gap-2 mt-1">
                  <img src={stats.mostSoldProduct.image} alt="" className="w-8 h-8 rounded-lg object-cover" />
                  <div className="truncate">
                    <span className="text-xs text-white font-bold block truncate leading-none">{stats.mostSoldProduct.name}</span>
                    <span className="text-[9px] text-muted font-mono block mt-1">Vandut in {stats.mostSoldProduct.count} portii</span>
                  </div>
                </div>
              ) : (
                <span className="text-xs text-muted block">Nu exista inca vanzari inregistrate</span>
              )}
            </div>

          </section>

          {/* RECHARTS DATA VISUALIZATION CELLS */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Revenue Area Chart */}
            <div className="bg-card border border-white/5 rounded-[24px] p-5 flex flex-col gap-4 lg:col-span-2 h-[340px]">
              <div>
                <h3 className="text-sm font-display font-bold text-white uppercase tracking-wider">Flux venit saptamanal (EUR)</h3>
                <span className="text-[10px] text-muted font-mono">Tranzactii ale clientilor din restaurant</span>
              </div>

              <div className="flex-1 w-full text-xs">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueChartData}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#c9a84c" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#c9a84c" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" stroke="#A0A4B0" fontSize={11} strokeOpacity={0.2} tickLine={false} />
                    <YAxis stroke="#A0A4B0" fontSize={11} strokeOpacity={0.2} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ background: '#171A21', border: '1px solid #232731', borderRadius: '12px', color: '#fff' }}
                      labelStyle={{ fontFamily: 'monospace', fontWeight: 'bold' }}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="#c9a84c" strokeWidth={2.5} fillOpacity={1} fill="url(#revGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-card border border-white/5 rounded-[24px] p-4 flex flex-col gap-3 h-[340px]">
              <div>
                <h3 className="text-sm font-display font-bold text-white uppercase tracking-wider">Timp mediu pe comanda</h3>
                <span className="text-[10px] text-muted font-mono">Masurat din Porneste gatirea pana la Livrata</span>
              </div>

              <div className="flex flex-1 flex-col justify-between rounded-[22px] border border-warning/20 bg-warning/10 p-4">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-warning">Medie actuala</p>
                  <p className="mt-2 text-3xl font-display font-extrabold text-white leading-none">
                    {formatKitchenDuration(stats.avgKitchenTimeMinutes)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-white/8 bg-background/70 px-3 py-2.5">
                    <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">Comenzi livrate</p>
                    <p className="mt-1.5 text-base font-display font-bold text-white">
                      {kitchenPerformanceOrders.filter((order) => order.completedAt).length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-background/70 px-3 py-2.5">
                    <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">Gatire pornita</p>
                    <p className="mt-1.5 text-base font-display font-bold text-white">
                      {kitchenPerformanceOrders.filter((order) => order.startedAt && !order.readyAt && !order.completedAt).length}
                    </p>
                  </div>
                  <div className="col-span-2 rounded-2xl border border-white/8 bg-background/70 px-3 py-2.5">
                    <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">Gata de livrare</p>
                    <p className="mt-1.5 text-base font-display font-bold text-white">
                      {kitchenPerformanceOrders.filter((order) => order.readyAt && !order.completedAt).length}
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </section>

          <section className="bg-card border border-white/5 rounded-[24px] p-5 flex flex-col gap-5">
            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
              <div>
                <h3 className="text-sm font-display font-bold text-white uppercase tracking-wider">Registru comenzi</h3>
                <p className="text-xs text-muted font-mono mt-1">Ziua curenta este selectata implicit, dar poti schimba rapid intervalul si gruparea.</p>
              </div>

              <div className="flex flex-col gap-3 xl:items-end">
                <div className="flex flex-wrap gap-2">
                  {analyticsRangeOptions.map((option) => {
                    const active = analyticsRange === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() => setAnalyticsRange(option.id)}
                        className={`px-3 py-2 rounded-xl text-[11px] font-mono font-bold transition-all ${
                          active
                            ? 'bg-primary text-white border border-primary'
                            : 'bg-background text-muted border border-white/8 hover:text-white'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-2">
                  {analyticsGroupOptions.map((option) => {
                    const active = analyticsGroup === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() => setAnalyticsGroup(option.id)}
                        className={`px-3 py-2 rounded-xl text-[11px] font-mono font-bold transition-all ${
                          active
                            ? 'bg-white text-background border border-white'
                            : 'bg-background text-muted border border-white/8 hover:text-white'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-[20px] border border-white/8 bg-background p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted">Comenzi</p>
                <p className="mt-3 text-2xl font-display font-bold text-white">{analyticsTotals.totalOrders}</p>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-background p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted">Valoare</p>
                <p className="mt-3 text-2xl font-display font-bold text-white">{formatCad(analyticsTotals.totalRevenue)}</p>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-background p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted">Produse vandute</p>
                <p className="mt-3 text-2xl font-display font-bold text-white">{analyticsTotals.totalItems}</p>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-background p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted">Medie / comanda</p>
                <p className="mt-3 text-2xl font-display font-bold text-white">{formatCad(analyticsTotals.averageOrderValue)}</p>
                <p className="mt-2 text-[10px] font-mono text-danger">{analyticsTotals.cancelledCount} anulate in interval</p>
              </div>
            </div>

            <div className="grid grid-cols-1 2xl:grid-cols-[1.1fr_1.4fr] gap-5">
              <div className="rounded-[22px] border border-white/8 bg-background overflow-hidden">
                <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-display font-bold text-white">Sumar grupat</h4>
                    <p className="text-[10px] font-mono text-muted mt-1">Tabel agregat dupa filtrul selectat</p>
                  </div>
                  <span className="text-[10px] font-mono uppercase text-primary">{analyticsGroupOptions.find((option) => option.id === analyticsGroup)?.label}</span>
                </div>

                {groupedAnalyticsOrders.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm text-muted">Nu exista comenzi in intervalul selectat.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-xs">
                      <thead className="bg-card/70 text-muted font-mono uppercase">
                        <tr>
                          <th className="px-4 py-3">Interval</th>
                          <th className="px-4 py-3">Comenzi</th>
                          <th className="px-4 py-3">Produse</th>
                          <th className="px-4 py-3">Mese</th>
                          <th className="px-4 py-3 text-right">Valoare</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedAnalyticsOrders.map((entry) => (
                          <tr key={entry.id} className="border-t border-white/6">
                            <td className="px-4 py-3 text-white font-semibold">{entry.label}</td>
                            <td className="px-4 py-3 text-white">{entry.ordersCount}</td>
                            <td className="px-4 py-3 text-white">{entry.itemsCount}</td>
                            <td className="px-4 py-3 text-muted">{entry.tablesLabel || '-'}</td>
                            <td className="px-4 py-3 text-right text-white font-mono">{formatCad(entry.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-[22px] border border-white/8 bg-background overflow-hidden">
                <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-display font-bold text-white">Lista comenzilor</h4>
                    <p className="text-[10px] font-mono text-muted mt-1">Toate comenzile plasate in intervalul ales</p>
                  </div>
                  <span className="text-[10px] font-mono uppercase text-primary">{analyticsTotals.totalOrders} intrari</span>
                </div>

                {filteredAnalyticsOrders.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm text-muted">Nu exista comenzi de afisat pentru acest interval.</div>
                ) : (
                  <div className="max-h-[560px] overflow-auto">
                    <table className="w-full min-w-[860px] text-left text-xs">
                      <thead className="sticky top-0 bg-card text-muted font-mono uppercase">
                        <tr>
                          <th className="px-4 py-3">Data</th>
                          <th className="px-4 py-3">Comanda</th>
                          <th className="px-4 py-3">Masa</th>
                          <th className="px-4 py-3">Sursa</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Incasare</th>
                          <th className="px-4 py-3">Produse</th>
                          <th className="px-4 py-3">Observatii</th>
                          <th className="px-4 py-3 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAnalyticsOrders.map((order) => {
                          const createdDate = new Date(order.createdAt);
                          const itemsCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

                          return (
                            <tr key={order.id} className="border-t border-white/6 align-top">
                              <td className="px-4 py-3 text-white">
                                <div className="font-semibold">{createdDate.toLocaleDateString('ro-RO')}</div>
                                <div className="text-muted font-mono mt-1">{formatDateTime(order.createdAt)}</div>
                              </td>
                              <td className="px-4 py-3 text-white">
                                <div className="font-semibold">{order.orderNumber}</div>
                                <div className="text-muted font-mono mt-1">{order.id.slice(0, 8)}</div>
                              </td>
                              <td className="px-4 py-3 text-white">Masa {order.tableNumber}</td>
                              <td className="px-4 py-3 text-white">{getOrderSourceLabel(order.source)}</td>
                              <td className="px-4 py-3">
                                <span className="inline-flex rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10px] font-mono uppercase text-primary">
                                  {getOrderStatusLabel(order.status)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-white">
                                <div className="font-semibold">{getPaymentMethodLabel(order.paymentMethod)}</div>
                                <div className="mt-1 text-muted font-mono">
                                  {order.settledAt ? formatDateTime(order.settledAt) : '-'}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-white">
                                <div>{itemsCount} produse</div>
                                <div className="text-muted mt-1 line-clamp-2">
                                  {order.items.map((item) => `${item.quantity}x ${item.productName}`).join(', ')}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-muted max-w-[220px]">
                                {order.notes ? <span className="line-clamp-3">{order.notes}</span> : '-'}
                              </td>
                              <td className="px-4 py-3 text-right text-white font-mono">{formatCad(order.subtotal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="bg-card border border-white/5 rounded-[24px] p-5 flex flex-col gap-5">
            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
              <div>
                <h3 className="text-sm font-display font-bold text-white uppercase tracking-wider">Timpi bucatarie pe comanda</h3>
                <p className="text-xs text-muted font-mono mt-1">Toate comenzile care au pornit in bucatarie si durata lor efectiva pana la livrare.</p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm text-white">
                Medie curenta: <span className="font-semibold text-warning">{formatKitchenDuration(stats.avgKitchenTimeMinutes)}</span>
              </div>
            </div>

            <div className="rounded-[22px] border border-white/8 bg-background overflow-hidden">
              <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-display font-bold text-white">Istoric operare bucatarie</h4>
                  <p className="text-[10px] font-mono text-muted mt-1">Pornire, livrare si durata pe fiecare comanda</p>
                </div>
                <span className="text-[10px] font-mono uppercase text-primary">{kitchenPerformanceOrders.length} intrari</span>
              </div>

              {kitchenPerformanceOrders.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted">Nu exista inca comenzi cu timp de bucatarie inregistrat.</div>
              ) : (
                <div className="max-h-[560px] overflow-auto">
                  <table className="w-full min-w-[940px] text-left text-xs">
                    <thead className="sticky top-0 bg-card text-muted font-mono uppercase">
                      <tr>
                        <th className="px-4 py-3">Comanda</th>
                        <th className="px-4 py-3">Masa</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Pornita</th>
                        <th className="px-4 py-3">Gata</th>
                        <th className="px-4 py-3">Livrata</th>
                        <th className="px-4 py-3">Timp bucatarie</th>
                        <th className="px-4 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kitchenPerformanceOrders.map((order) => {
                        const durationMinutes = getKitchenDurationMinutes(order);

                        return (
                          <tr key={`kitchen-${order.id}`} className="border-t border-white/6 align-top">
                            <td className="px-4 py-3 text-white">
                              <div className="font-semibold">{order.orderNumber}</div>
                              <div className="mt-1 text-muted font-mono">{getOrderSourceLabel(order.source)}</div>
                            </td>
                            <td className="px-4 py-3 text-white">Masa {order.tableNumber}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10px] font-mono uppercase text-primary">
                                {getOrderStatusLabel(order.status)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-white">{order.startedAt ? formatDateTime(order.startedAt) : '-'}</td>
                            <td className="px-4 py-3 text-white">{order.readyAt ? formatDateTime(order.readyAt) : '-'}</td>
                            <td className="px-4 py-3 text-white">{order.completedAt ? formatDateTime(order.completedAt) : '-'}</td>
                            <td className="px-4 py-3 text-white font-mono">
                              {durationMinutes !== null ? (
                                <span className="rounded-full border border-warning/20 bg-warning/10 px-2.5 py-1 text-warning">
                                  {formatKitchenDuration(durationMinutes)}
                                </span>
                              ) : (
                                <span className="text-muted">{order.startedAt ? 'In curs' : '-'}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-white font-mono">{formatCad(order.subtotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="bg-card border border-white/5 rounded-[24px] p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-display font-bold text-white uppercase tracking-wider">Recenzii clienti</h3>
                <p className="text-xs text-muted font-mono mt-1">Feedback-ul trimis din telefon apare aici si ramane salvat pentru admin.</p>
              </div>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-primary">
                {reviews.length} total
              </span>
            </div>

            {reviews.length === 0 ? (
              <div className="rounded-[20px] border border-white/8 bg-background px-4 py-8 text-center text-sm text-muted">
                Nu exista inca recenzii trimise de clienti.
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {reviews.map((review) => (
                  <div key={review.id} className="rounded-[20px] border border-white/8 bg-background p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-display font-bold text-white truncate">
                          {review.productName || 'Recenzie generala'}
                        </p>
                        <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                          {review.customerName || 'Client anonim'} • {formatDateTime(review.createdAt)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-warning/20 bg-warning/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-warning">
                        {review.rating}/5 stele
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/80">
                      {review.comment?.trim() || 'Clientul a trimis doar rating, fara comentariu.'}
                    </p>
                    <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">
                      Comanda {review.orderId}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      )}

      {activeTab === 'menu' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* CATEGORIES CONSOLE LIST */}
          <div className="bg-card rounded-[24px] border border-white/5 p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <h3 className="text-xs font-mono text-muted uppercase font-bold tracking-wider">Categorii meniu</h3>
              <button
                onClick={() => {
                  setIsEditingCategory('new');
                  setCategoryForm({ name: '', icon: '🥗' });
                }}
                className="bg-primary hover:bg-secondary text-white text-[10px] font-mono py-1 px-2.5 rounded-lg font-bold cursor-pointer"
              >
                + Adauga categorie
              </button>
            </div>

            {isEditingCategory && (
              <div className="p-3 bg-background rounded-xl border border-white/5 space-y-2 text-xs">
                <div>
                  <label className="text-muted block text-[9px] uppercase font-mono mb-1">Nume categorie</label>
                  <input
                    type="text"
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-card rounded-lg py-1.5 px-3 text-white focus:outline-none text-xs border border-white/5"
                  />
                </div>
                <div>
                  <label className="text-muted block text-[9px] uppercase font-mono mb-1">Emoji / icon</label>
                  <input
                    type="text"
                    value={categoryForm.icon}
                    onChange={(e) => setCategoryForm(prev => ({ ...prev, icon: e.target.value }))}
                    className="w-full bg-card rounded-lg py-1.5 px-3 text-white focus:outline-none text-xs border border-white/5"
                  />
                </div>
                <div>
                  <label className="text-muted block text-[9px] uppercase font-mono mb-1">Alege rapid o iconita</label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {categoryIconOptions.map((option) => (
                      <button
                        key={`${option.icon}-${option.label}`}
                        type="button"
                        title={option.label}
                        onClick={() => setCategoryForm((prev) => ({ ...prev, icon: option.icon }))}
                        className={`h-10 rounded-lg border text-lg transition-all ${
                          categoryForm.icon === option.icon
                            ? 'border-primary bg-primary/15 shadow-[0_0_0_1px_rgba(201,168,76,0.25)]'
                            : 'border-white/5 bg-card hover:border-white/10'
                        }`}
                      >
                        {option.icon}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-muted">
                    Optiuni pentru mancare, bauturi, desert, cafea, vin, bere, suc si narghilea.
                  </p>
                </div>

                <div className="flex gap-2 pt-1.5">
                  <button 
                    onClick={() => setIsEditingCategory(null)} 
                    className="flex-1 bg-white/5 py-1.5 rounded text-[10px] text-muted hover:text-white"
                  >
                    Anuleaza
                  </button>
                  <button 
                    onClick={handleSaveCategory} 
                    className="flex-1 bg-primary py-1.5 rounded text-[10px] text-white font-bold"
                  >
                    Salveaza
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
              {categories.map(c => (
                <div key={c.id} className="bg-background/40 p-2.5 rounded-xl border border-white/5 flex items-center justify-between text-xs">
                  <span className="font-semibold flex items-center gap-2">
                    <span className="text-lg">{c.icon}</span> {c.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setIsEditingCategory(c.id);
                        setCategoryForm({ name: c.name, icon: c.icon });
                      }}
                      className="p-1 px-2 text-[10px] font-mono text-muted hover:text-white bg-[#1C202B] rounded-lg border border-white/5"
                    >
                      Editeaza
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(c.id)}
                      className="p-1 text-danger hover:text-red-300"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PRODUCTS MANAGEMENT SHEET */}
          <div className="lg:col-span-2 bg-card rounded-[24px] border border-white/5 p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <h3 className="text-xs font-mono text-muted uppercase font-bold tracking-wider">Inventar produse</h3>
              <button
                onClick={() => {
                  setIsEditingProduct('new');
                  setProductForm({
                    name: '',
                    description: '',
                    price: 0,
                    imageUrl: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80',
                    rating: 5.0,
                    reviewsCount: 12,
                    prepTime: 12,
                    isBestseller: false,
                    categoryId: categories[0]?.id || '',
                    available: true,
                    allergens: [],
                    nutritionInfo: createEmptyNutritionInfo(),
                    optionGroups: [],
                  });
                  setProductPriceInput('');
                  setNutritionValuesText('');
                }}
                className="bg-primary hover:bg-secondary text-white text-[11px] font-mono py-1.5 px-3.5 rounded-lg font-bold cursor-pointer"
              >
                + Adauga produs nou
              </button>
            </div>

            {isEditingProduct && (
              <div className="bg-background border border-white/10 p-4 rounded-2xl flex flex-col gap-3 text-xs max-h-[78vh] overflow-y-auto">
                <span className="text-xs font-mono text-primary font-bold">{isEditingProduct === 'new' ? 'Produs nou' : 'Actualizare produs'}</span>
                <p className="text-[11px] text-muted leading-5">
                  Completeaza datele de baza, apoi adauga mai jos si sectiunea de nutritie pentru popup-ul din meniul clientului.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-muted uppercase">Nume produs</label>
                    <input
                      type="text"
                      value={productForm.name}
                      onChange={(e) => setProductForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-muted uppercase">Pret (lei)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={productPriceInput}
                      onChange={(e) => setProductPriceInput(e.target.value)}
                      placeholder="35"
                      className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-muted uppercase">Link imagine</label>
                    <input
                      type="text"
                      value={productForm.imageUrl}
                      onChange={(e) => setProductForm(prev => ({ ...prev, imageUrl: e.target.value }))}
                      className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-muted uppercase">Categorie</label>
                    <select
                      value={productForm.categoryId}
                      onChange={(e) => setProductForm(prev => ({ ...prev, categoryId: e.target.value }))}
                      className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                    >
                      {categories.map(c => (
                        <option key={c.id} value={c.id} className="bg-card text-white">{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-muted uppercase">Timp pregatire (min)</label>
                    <input
                      type="number"
                      value={productForm.prepTime}
                      onChange={(e) => setProductForm(prev => ({ ...prev, prepTime: Number(e.target.value) }))}
                      className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                    />
                  </div>
                  {/* Toggles */}
                  <div className="flex items-center gap-6 mt-4">
                    <label className="flex items-center gap-2 cursor-pointer font-mono text-[11px] text-muted">
                      <input
                        type="checkbox"
                        checked={productForm.isBestseller}
                        onChange={(e) => setProductForm(prev => ({ ...prev, isBestseller: e.target.checked }))}
                        className="w-4 h-4 rounded border-white/10 text-primary focus:ring-0 cursor-pointer accent-primary"
                      />
                      Recomandat
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer font-mono text-[11px] text-muted">
                      <input
                        type="checkbox"
                        checked={productForm.available}
                        onChange={(e) => setProductForm(prev => ({ ...prev, available: e.target.checked }))}
                        className="w-4 h-4 rounded border-white/10 text-primary focus:ring-0 cursor-pointer accent-primary"
                      />
                      Disponibil
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono text-muted uppercase">Descriere</label>
                  <textarea
                    rows={2}
                    value={productForm.description}
                    onChange={(e) => setProductForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                  />
                </div>

                <div className="rounded-2xl border border-white/8 bg-card/70 p-4 flex flex-col gap-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-display font-bold text-white">Optiuni dinamice</h4>
                      <p className="text-[10px] font-mono text-muted mt-1">
                        Poti adauga grupe precum sosuri, garnituri, toppinguri sau extra ingrediente.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addOptionGroupToProduct}
                      className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-[11px] font-mono font-bold text-primary"
                    >
                      + Adauga grupa
                    </button>
                  </div>

                  {(productForm.optionGroups || []).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-[11px] text-muted">
                      Acest produs nu are inca optiuni suplimentare.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(productForm.optionGroups || []).map((group) => (
                        <div key={group.id} className="rounded-2xl border border-white/8 bg-background p-3">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] font-mono text-muted uppercase">Nume grupa</label>
                              <input
                                type="text"
                                value={group.name}
                                onChange={(e) => updateOptionGroup(group.id, (current) => ({ ...current, name: e.target.value }))}
                                placeholder="Ex: Sosuri"
                                className="w-full bg-card border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-mono text-muted uppercase">Tip selectie</label>
                                <select
                                  value={group.selectionType}
                                  onChange={(e) =>
                                    updateOptionGroup(group.id, (current) => ({
                                      ...current,
                                      selectionType: e.target.value === 'multiple' ? 'multiple' : 'single',
                                    }))
                                  }
                                  className="w-full bg-card border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                                >
                                  <option value="single">O singura</option>
                                  <option value="multiple">Mai multe</option>
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-mono text-muted uppercase">Max selectii</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={group.selectionType === 'multiple' ? group.maxSelections || 2 : 1}
                                  onChange={(e) =>
                                    updateOptionGroup(group.id, (current) => ({
                                      ...current,
                                      maxSelections: Math.max(1, Number(e.target.value || 1)),
                                    }))
                                  }
                                  disabled={group.selectionType !== 'multiple'}
                                  className="w-full bg-card border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none disabled:opacity-50"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <label className="flex items-center gap-2 cursor-pointer font-mono text-[11px] text-muted">
                              <input
                                type="checkbox"
                                checked={group.required}
                                onChange={(e) => updateOptionGroup(group.id, (current) => ({ ...current, required: e.target.checked }))}
                                className="w-4 h-4 rounded border-white/10 text-primary focus:ring-0 cursor-pointer accent-primary"
                              />
                              Obligatorie la comanda
                            </label>
                            <button
                              type="button"
                              onClick={() => removeOptionGroup(group.id)}
                              className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-[10px] font-mono font-bold text-danger"
                            >
                              Sterge grupa
                            </button>
                          </div>

                          <div className="mt-3 space-y-2">
                            {group.choices.map((choice) => (
                              <div key={choice.id} className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-2">
                                <input
                                  type="text"
                                  value={choice.name}
                                  onChange={(e) =>
                                    updateOptionGroup(group.id, (current) => ({
                                      ...current,
                                      choices: current.choices.map((entry) =>
                                        entry.id === choice.id ? { ...entry, name: e.target.value } : entry
                                      ),
                                    }))
                                  }
                                  placeholder="Ex: Sos usturoi"
                                  className="w-full bg-card border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  value={choice.priceDelta}
                                  onChange={(e) =>
                                    updateOptionGroup(group.id, (current) => ({
                                      ...current,
                                      choices: current.choices.map((entry) =>
                                        entry.id === choice.id ? { ...entry, priceDelta: Number(e.target.value || 0) } : entry
                                      ),
                                    }))
                                  }
                                  placeholder="0"
                                  className="w-full bg-card border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeOptionChoice(group.id, choice.id)}
                                  className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-mono text-muted hover:text-white"
                                >
                                  Sterge
                                </button>
                              </div>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => addOptionChoice(group.id)}
                            className="mt-3 rounded-xl border border-white/10 bg-card px-3 py-2 text-[11px] font-mono font-bold text-white"
                          >
                            + Adauga varianta
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/8 bg-card/70 p-4 flex flex-col gap-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-display font-bold text-white">Date nutritionale</h4>
                      <p className="text-[10px] font-mono text-muted mt-1">
                        Aceste campuri apar in popup-ul "Informatii nutritionale" din interfata clientului.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-mono font-bold uppercase text-primary">
                      Optional
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3.5">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-muted uppercase">Ingrediente nutritionale</label>
                    <textarea
                      rows={6}
                      value={productForm.nutritionInfo?.ingredientsText || ''}
                      onChange={(e) =>
                        setProductForm((prev) => ({
                          ...prev,
                          nutritionInfo: {
                            ...(prev.nutritionInfo || createEmptyNutritionInfo()),
                            ingredientsText: e.target.value,
                          },
                        }))
                      }
                      placeholder="BLAT DE PIZZA (...)\nSOS DE PIZZA 50g (...)\nMOZZARELLA 140g (...)"
                      className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none resize-y"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-muted uppercase">Alergeni / urme</label>
                    <textarea
                      rows={3}
                      value={productForm.nutritionInfo?.allergenTraceText || ''}
                      onChange={(e) =>
                        setProductForm((prev) => ({
                          ...prev,
                          nutritionInfo: {
                            ...(prev.nutritionInfo || createEmptyNutritionInfo()),
                            allergenTraceText: e.target.value,
                          },
                        }))
                      }
                      placeholder="Poate sa contina urme de: lapte, lactoza, mustar"
                      className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none resize-y"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-muted uppercase">Titlu valori nutritionale</label>
                    <input
                      type="text"
                      value={productForm.nutritionInfo?.valuesHeading || 'Valoare energetica pentru 100 gr'}
                      onChange={(e) =>
                        setProductForm((prev) => ({
                          ...prev,
                          nutritionInfo: {
                            ...(prev.nutritionInfo || createEmptyNutritionInfo()),
                            valuesHeading: e.target.value,
                          },
                        }))
                      }
                      className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-muted uppercase">Valori nutritionale pe linii</label>
                    <textarea
                      rows={8}
                      value={nutritionValuesText}
                      onChange={(e) => setNutritionValuesText(e.target.value)}
                      placeholder={'Kilojouli - 1141.60 kj\nKilocalorii - 272.85 kcal\nProteine - 11.6 g\nGlucide - 32.3 g'}
                      className="w-full bg-[#1C202B] border border-white/5 rounded-lg py-2 px-3 text-white focus:outline-none resize-y"
                    />
                    <p className="text-[10px] text-muted leading-5">
                      Scrie cate o valoare pe linie in formatul: Nume - valoare
                    </p>
                  </div>
                </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                  <button
                    onClick={() => setIsEditingProduct(null)}
                    className="py-1.5 px-4 rounded-lg border border-white/10 text-[11px] text-muted hover:text-white"
                  >
                    Anuleaza
                  </button>
                  <button
                    onClick={handleSaveProduct}
                    className="py-1.5 px-5 rounded-lg bg-primary text-white text-[11px] font-mono font-bold"
                  >
                    Salveaza modificarile
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2.5 max-h-[70vh] overflow-y-auto">
              {products.map(p => (
                <div key={p.id} className="bg-background/40 hover:bg-[#1C202B]/45 rounded-2xl border border-white/5 p-3 flex gap-4 items-center justify-between text-xs transition-all">
                  <div className="flex items-center gap-3">
                    <img src={p.imageUrl} alt="" className="w-11 h-11 rounded-lg object-cover" />
                    <div>
                      <h4 className="font-semibold text-white">{p.name}</h4>
                      <p className="text-[10px] text-muted font-mono">{formatCad(p.price)} • {categories.find(c => c.id === p.categoryId)?.name || '-'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className={`text-[8px] font-mono uppercase px-2 py-0.5 rounded-full font-bold ${p.nutritionInfo?.ingredientsText || p.nutritionInfo?.valuesPer100g?.length ? 'bg-primary/10 text-primary' : 'bg-white/5 text-muted'}`}>
                      {p.nutritionInfo?.ingredientsText || p.nutritionInfo?.valuesPer100g?.length ? 'Are nutritie' : 'Fara nutritie'}
                    </span>
                    <span className={`text-[8px] font-mono uppercase px-2 py-0.5 rounded-full font-bold ${(p.optionGroups || []).length > 0 ? 'bg-warning/10 text-warning' : 'bg-white/5 text-muted'}`}>
                      {(p.optionGroups || []).length > 0 ? `${p.optionGroups?.length} grupe optiuni` : 'Fara optiuni'}
                    </span>
                    {p.isBestseller && (
                      <span className="bg-red-500/10 border border-red-500/20 text-red-500 text-[8px] font-mono font-bold px-2 py-0.5 rounded-full uppercase">
                        Recomandat
                      </span>
                    )}
                    <span className={`text-[8px] font-mono uppercase px-2 py-0.5 rounded-full font-bold ${p.available ? 'bg-success/10 text-success' : 'bg-muted/10 text-muted'}`}>
                      {p.available ? 'Disponibil' : 'Indisponibil'}
                    </span>
                    <button
                      onClick={() => {
                        setIsEditingProduct(p.id);
                        setProductForm({
                          ...p,
                          nutritionInfo: p.nutritionInfo || createEmptyNutritionInfo(),
                          optionGroups: p.optionGroups || [],
                        });
                        setProductPriceInput(String(p.price).replace('.', ','));
                        setNutritionValuesText(serializeNutritionValues(p.nutritionInfo?.valuesPer100g || []));
                      }}
                      className="p-1 px-2.5 text-[10px] font-mono text-muted hover:text-white bg-[#1C202B] rounded-lg border border-white/5"
                    >
                      Editeaza
                    </button>
                    <button
                      onClick={() => handleDeleteProduct(p.id)}
                      className="p-1.5 text-danger hover:text-red-300"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {activeTab === 'qr' && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div>
              <h3 className="text-sm font-display font-bold text-white uppercase tracking-wider">Generator QR pentru mese</h3>
              <p className="text-xs text-muted font-mono mt-1">Genereaza coduri QR, descarca SVG si tipareste carduri</p>
            </div>
          </div>

          <div className="bg-card border border-white/5 rounded-[24px] p-5 grid grid-cols-1 lg:grid-cols-[1.05fr_1.95fr] gap-5">
            <div className="rounded-[22px] border border-white/8 bg-background p-4 flex flex-col gap-4">
              <div>
                <h4 className="text-sm font-display font-bold text-white">Adauga mese noi</h4>
                <p className="text-[10px] font-mono text-muted mt-1">Creezi rapid mese pentru terasa sau interior, cu numerotare automata.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono uppercase text-muted">Zona</label>
                  <select
                    value={newTableArea}
                    onChange={(event) => setNewTableArea(event.target.value as TableArea)}
                    className="w-full bg-card border border-white/5 rounded-lg py-2.5 px-3 text-white focus:outline-none"
                  >
                    <option value="INTERIOR" className="bg-card text-white">Interior</option>
                    <option value="TERASA" className="bg-card text-white">Terasa</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono uppercase text-muted">Numar mese</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={newTableCount}
                    onChange={(event) => setNewTableCount(Math.max(1, Number(event.target.value) || 1))}
                    className="w-full bg-card border border-white/5 rounded-lg py-2.5 px-3 text-white focus:outline-none"
                  />
                </div>
              </div>

              <button
                onClick={handleAddNewTable}
                className="bg-primary hover:bg-secondary text-white text-xs font-mono font-semibold py-3 px-4 rounded-xl cursor-pointer"
              >
                + Adauga {newTableCount} {newTableCount === 1 ? 'masa' : 'mese'} in {getTableAreaLabel(newTableArea)}
              </button>

              <div className="rounded-2xl border border-white/8 bg-card/60 p-4">
                <p className="text-[10px] font-mono uppercase text-muted">Rezumat zone</p>
                <div className="mt-3 flex flex-col gap-2 text-sm">
                  {groupedTablesByArea.map((group) => (
                    <div key={group.area} className="flex items-center justify-between">
                      <span className="text-white">{group.label}</span>
                      <span className="text-muted font-mono">{group.tables.length} mese</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {tables.map(tb => {
              const qrLabel = getTableQrLabel(tb);
              const { svgMarkup, targetUrl } = generateQrSvg(tb.number, getAppBaseUrl(), qrLabel);
              return (
                <div key={tb.id} className="bg-card border border-white/5 rounded-[22px] p-3 flex flex-col items-center text-center gap-2.5 shadow-sm relative min-w-0">
                  <div className="absolute top-3 left-3 bg-primary/25 border border-primary/40 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono text-primary shadow-inner">
                    {qrLabel}
                  </div>
                  <div className="absolute top-3 right-3 bg-background border border-white/8 px-2 py-0.5 rounded-full text-[9px] font-bold font-mono text-white">
                    {getTableAreaLabel(tb.area)}
                  </div>

                  {/* Render vector SVG directly using React rendering pattern */}
                  <div 
                    className="w-32 h-32 bg-white p-2 rounded-xl mt-5 shadow-xl flex items-center justify-center overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: svgMarkup.replace('width="full"', 'width="100%"').replace('height="full"', 'height="100%"') }}
                  />

                  <div className="w-full min-w-0">
                    <span className="text-xs font-semibold text-white block truncate">{tb.name || `Masa ${tb.number}`}</span>
                    <span className="text-[9px] font-mono text-muted block uppercase mt-0.5">Link scanare</span>
                    <p className="text-[10px] text-white/70 font-mono truncate bg-background border border-white/5 py-1.5 px-2 rounded-lg mt-1 select-all">{targetUrl}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 w-full">
                    <button
                      onClick={() => downloadQrSvg(tb)}
                      className="bg-background hover:bg-black border border-white/5 text-[10px] font-mono font-bold py-2 px-2 rounded-lg cursor-pointer text-muted hover:text-white transition-all transform active:scale-95"
                    >
                      SVG
                    </button>
                    <button
                      onClick={() => void downloadQrPng(tb)}
                      className="bg-background hover:bg-black border border-white/5 text-[10px] font-mono font-bold py-2 px-2 rounded-lg cursor-pointer text-muted hover:text-white transition-all transform active:scale-95"
                    >
                      PNG
                    </button>
                    <button
                      onClick={() => printQrCode(tb)}
                      className="bg-primary hover:bg-secondary text-white text-[10px] font-mono font-bold py-2 px-2 rounded-lg cursor-pointer transition-all transform active:scale-95"
                    >
                      Print
                    </button>
                  </div>
                  <button
                    onClick={() => handleDeleteTable(tb.id, tb.name || `Masa ${tb.number}`)}
                    className="w-full rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[10px] font-mono font-bold text-danger hover:bg-danger/15"
                  >
                    Sterge masa
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}

      {activeTab === 'reviews' && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div>
              <h3 className="text-sm font-display font-bold text-white uppercase tracking-wider">Feedback clienti</h3>
              <p className="text-xs text-muted font-mono mt-1">Toate recenziile trimise de pe telefonul clientului.</p>
            </div>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-primary">
              {reviews.length} recenzii
            </span>
          </div>

          {renderReviewsSection()}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="bg-card rounded-[24px] border border-white/5 p-5 flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-display font-bold text-white uppercase tracking-wider">Configurare meniu si acces</h3>
            <p className="text-xs text-muted font-mono mt-0.5">
              Controlezi comenzile din telefon si credentialele interne pentru admin, ospatar si bucatarie.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-[18px] border border-white/8 bg-background px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-primary">Control comenzi client</p>
                  <h2 className="mt-1 text-sm font-display font-bold text-white">Comenzi din telefon</h2>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Cand este oprit, clientul vede meniul si cosul, dar cheama ospatarul pentru trimitere.
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em] ${
                      settings.customerOrderingEnabled
                        ? 'border border-success/20 bg-success/10 text-success'
                        : 'border border-danger/20 bg-danger/10 text-danger'
                    }`}
                  >
                    {settings.customerOrderingEnabled ? 'Pornit' : 'Oprit'}
                  </span>

                  <button
                    type="button"
                    onClick={toggleCustomerOrdering}
                    aria-pressed={settings.customerOrderingEnabled}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${
                      settings.customerOrderingEnabled
                        ? 'border-success/30 bg-success/20'
                        : 'border-white/10 bg-white/10'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition ${
                        settings.customerOrderingEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-[18px] border border-white/8 bg-background px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-primary">Acces ospatar</p>
                  <h3 className="mt-1 text-sm font-display font-bold text-white">PIN ospatar</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">PIN-ul este salvat hash-uit pe server si nu mai este expus in setari.</p>
                </div>

                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={waiterPinInput}
                    onChange={(event) => setWaiterPinInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="0000"
                    className="w-full rounded-xl border border-white/8 bg-card px-3 py-2.5 text-sm text-white outline-none sm:w-28"
                  />
                  <button
                    onClick={saveWaiterPin}
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    Salveaza
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[10px] font-mono uppercase text-muted">
                {accessControl.waiterPinConfigured ? 'PIN activ' : 'PIN lipsa'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="rounded-[18px] border border-white/8 bg-background px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-primary">Acces bucatarie</p>
                  <h3 className="mt-1 text-sm font-display font-bold text-white">PIN bucatarie</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">Protejeaza panoul intern de bucatarie cu un PIN separat.</p>
                </div>

                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={kitchenPinInput}
                    onChange={(event) => setKitchenPinInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="0000"
                    className="w-full rounded-xl border border-white/8 bg-card px-3 py-2.5 text-sm text-white outline-none sm:w-28"
                  />
                  <button
                    onClick={saveKitchenPin}
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    Salveaza
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[10px] font-mono uppercase text-muted">
                {accessControl.kitchenPinConfigured ? 'PIN activ' : 'PIN lipsa'}
              </p>
            </div>

            <div className="rounded-[18px] border border-white/8 bg-background px-4 py-3">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-primary">Acces admin</p>
                <h3 className="mt-1 text-sm font-display font-bold text-white">Login admin</h3>
                <p className="mt-1 text-xs leading-5 text-muted">Username si parola separate, stocate doar in forma hash-uita pe server.</p>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <input
                  type="text"
                  value={adminUsernameInput}
                  onChange={(event) => setAdminUsernameInput(event.target.value)}
                  placeholder="admin"
                  className="w-full rounded-xl border border-white/8 bg-card px-3 py-2.5 text-sm text-white outline-none"
                />
                <input
                  type="password"
                  value={adminPasswordInput}
                  onChange={(event) => setAdminPasswordInput(event.target.value)}
                  placeholder="Parola noua"
                  className="w-full rounded-xl border border-white/8 bg-card px-3 py-2.5 text-sm text-white outline-none"
                />
                <button
                  onClick={saveAdminCredentials}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Salveaza
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/8 bg-card px-2.5 py-1 text-[10px] font-mono uppercase text-muted">
                  User: {accessControl.adminUsername}
                </span>
                <span className="rounded-full border border-white/8 bg-card px-2.5 py-1 text-[10px] font-mono uppercase text-muted">
                  {accessControl.adminPasswordConfigured ? 'Parola setata' : 'Parola lipsa'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
