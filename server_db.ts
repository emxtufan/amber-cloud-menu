import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  Bill,
  BillStatus,
  Category,
  Ingredient,
  Order,
  OrderItem,
  PaymentMethod,
  OrderSource,
  OrderStatus,
  Product,
  Review,
  RestaurantSettings,
  SystemStats,
  Table,
  TableStatus,
  WaiterRequest,
} from './src/types.js';

const DB_FILE = path.join(process.cwd(), 'data_store.json');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_API_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_REST_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1` : '';
const SUPABASE_APP_STATE_TABLE = 'app_state';
const SUPABASE_APP_STATE_ID = 'restaurant_qr_state';

interface DatabaseSchema {
  settings: RestaurantSettings;
  accessControl: AccessControlData;
  tables: Table[];
  categories: Category[];
  products: Product[];
  ingredients: Ingredient[];
  orders: Order[];
  reviews: Review[];
  bills: Bill[];
  waiterRequests: WaiterRequest[];
}

interface SupabaseAppStateRow {
  id: string;
  payload: Partial<DatabaseSchema>;
  updated_at?: string;
}

const DEFAULT_SETTINGS: RestaurantSettings = {
  customerOrderingEnabled: true,
};

interface AccessControlData {
  adminUsername: string;
  adminPasswordHash: string;
  waiterPinHash: string;
  kitchenPinHash: string;
}

type AccessRole = 'ADMIN' | 'WAITER' | 'KITCHEN';

function createPasswordHash(value: string) {
  const normalized = value.trim();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(normalized, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPasswordHash(value: string, serializedHash: string) {
  if (!serializedHash || !value.trim()) {
    return false;
  }

  const [salt, storedHash] = serializedHash.split(':');
  if (!salt || !storedHash) {
    return false;
  }

  const candidateHash = crypto.scryptSync(value.trim(), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(candidateHash, 'hex'));
}

const DEFAULT_ACCESS_CONTROL = (): AccessControlData => ({
  adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim() || 'admin',
  adminPasswordHash: createPasswordHash(process.env.ADMIN_PASSWORD || 'admin1234'),
  waiterPinHash: createPasswordHash((process.env.WAITER_PIN || '1111').replace(/\D/g, '').slice(0, 8) || '1111'),
  kitchenPinHash: createPasswordHash((process.env.KITCHEN_PIN || '2222').replace(/\D/g, '').slice(0, 8) || '2222'),
});

function createSessionId(tableId: string, timestamp = Date.now()) {
  return `session-table-${tableId}-${timestamp}`;
}

function getTimestamp(value?: string) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

const DEFAULT_INGREDIENTS: Ingredient[] = [

];

const DEFAULT_CATEGORIES: Category[] = [
  
];

const DEFAULT_PRODUCTS = (): Product[] => [
  
];

const DEFAULT_TABLES: Table[] = Array.from({ length: 10 }, (_, index) => {
  return {
    id: String(index + 1),
    number: index + 1,
    status: TableStatus.AVAILABLE,
    area: 'INTERIOR',
  };
});

const DEFAULT_ORDERS: Order[] = [];

const DEFAULT_REVIEWS: Review[] = [];

const DEFAULT_BILLS: Bill[] = [];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isActiveOrder(status: OrderStatus) {
  return [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
  ].includes(status);
}

function normalizeOrderItem(item: any, fallbackId: string): OrderItem {
  return {
    id: String(item?.id || fallbackId),
    productId: String(item?.productId || 'unknown-product'),
    productName: String(item?.productName || item?.name || 'Menu Item'),
    price: Number(item?.price || 0),
    quantity: Math.max(1, Number(item?.quantity || 1)),
    notes: item?.notes ? String(item.notes) : undefined,
    sendToKitchen: typeof item?.sendToKitchen === 'boolean' ? item.sendToKitchen : undefined,
    selectedOptions: normalizeSelectedOrderOptions(item?.selectedOptions),
  };
}

function normalizeSelectedOrderOptions(selectedOptions: any): OrderItem['selectedOptions'] {
  if (!Array.isArray(selectedOptions)) {
    return [];
  }

  return selectedOptions.map((option, index) => ({
    groupId: String(option?.groupId || `group-${index}`),
    groupName: String(option?.groupName || 'Optiune'),
    choiceId: String(option?.choiceId || `choice-${index}`),
    choiceName: String(option?.choiceName || 'Varianta'),
    priceDelta: Number(option?.priceDelta || 0),
  }));
}

function normalizeProductOptionGroups(optionGroups: any): Product['optionGroups'] {
  if (!Array.isArray(optionGroups)) {
    return [];
  }

  return optionGroups
    .map((group, groupIndex) => ({
      id: String(group?.id || `option-group-${groupIndex}`),
      name: String(group?.name || 'Optiuni'),
      required: Boolean(group?.required),
      selectionType: (group?.selectionType === 'multiple' ? 'multiple' : 'single') as 'single' | 'multiple',
      maxSelections:
        group?.selectionType === 'multiple' && Number(group?.maxSelections || 0) > 0
          ? Number(group.maxSelections)
          : undefined,
      choices: Array.isArray(group?.choices)
        ? group.choices.map((choice: any, choiceIndex: number) => ({
            id: String(choice?.id || `option-choice-${groupIndex}-${choiceIndex}`),
            name: String(choice?.name || 'Varianta'),
            priceDelta: Number(choice?.priceDelta || 0),
          }))
        : [],
    }))
    .filter((group) => group.name.trim() && group.choices.length > 0);
}

function hasFinishedOrder(status: OrderStatus) {
  return [OrderStatus.DELIVERED, OrderStatus.CANCELLED].includes(status);
}

function getAreaSequenceLabel(area: string, existingTables: Table[]) {
  const sameAreaCount = existingTables.filter((table) => (table.area || 'INTERIOR') === area).length;
  const nextIndex = sameAreaCount + 1;
  return area === 'TERASA' ? `Terasa ${nextIndex}` : `Interior ${nextIndex}`;
}

export class DatabaseEngine {
  private static data: DatabaseSchema | null = null;
  private static initializePromise: Promise<void> | null = null;
  private static persistQueue: Promise<void> = Promise.resolve();

  static async initialize() {
    if (this.data) {
      return;
    }

    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.initializePromise = this.bootstrap();
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  static async flush() {
    await this.persistQueue.catch(() => undefined);
  }

  private static async bootstrap() {
    if (this.data) {
      return;
    }

    if (this.hasSupabaseConfig()) {
      try {
        const remoteState = await this.readRemoteSnapshot();
        if (remoteState) {
          this.data = this.migrateData(remoteState);
          this.writeLocalSnapshot();
          return;
        }

        const localState = this.readLocalSnapshot();
        if (localState) {
          this.data = this.migrateData(localState);
          this.writeLocalSnapshot();
          await this.writeRemoteSnapshot();
          return;
        }

        this.data = this.createInitialData();
        this.recalculateAllTableStatuses();
        this.writeLocalSnapshot();
        await this.writeRemoteSnapshot();
        return;
      } catch (error) {
        console.error('Nu am putut initializa stocarea din Supabase. Folosesc fallback local.', error);
      }
    }

    const localState = this.readLocalSnapshot();
    if (localState) {
      this.data = this.migrateData(localState);
      this.writeLocalSnapshot();
      return;
    }

    this.data = this.createInitialData();
    this.recalculateAllTableStatuses();
    this.writeLocalSnapshot();
  }

  private static hasSupabaseConfig() {
    return Boolean(SUPABASE_REST_URL && SUPABASE_API_KEY);
  }

  private static getSupabaseHeaders() {
    if (!SUPABASE_API_KEY) {
      throw new Error('Lipseste cheia Supabase pentru persistenta REST.');
    }

    return {
      apikey: SUPABASE_API_KEY,
      Authorization: `Bearer ${SUPABASE_API_KEY}`,
      'Content-Type': 'application/json',
    };
  }

  private static readLocalSnapshot(): Partial<DatabaseSchema> | null {
    if (!fs.existsSync(DB_FILE)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      return JSON.parse(raw) as Partial<DatabaseSchema>;
    } catch (error) {
      console.error('Error loading data_store.json, creating a new store instead.', error);
      return null;
    }
  }

  private static writeLocalSnapshot() {
    if (!this.data) {
      return;
    }

    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Critical database write error:', error);
    }
  }

  private static async readRemoteSnapshot(): Promise<Partial<DatabaseSchema> | null> {
    if (!this.hasSupabaseConfig()) {
      return null;
    }

    const url = new URL(`${SUPABASE_REST_URL}/${SUPABASE_APP_STATE_TABLE}`);
    url.searchParams.set('id', `eq.${SUPABASE_APP_STATE_ID}`);
    url.searchParams.set('select', 'id,payload,updated_at');

    const response = await fetch(url, {
      headers: this.getSupabaseHeaders(),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase load failed: ${response.status} ${detail}`);
    }

    const rows = (await response.json()) as SupabaseAppStateRow[];
    return rows[0]?.payload || null;
  }

  private static async writeRemoteSnapshot() {
    if (!this.data || !this.hasSupabaseConfig()) {
      return;
    }

    const response = await fetch(`${SUPABASE_REST_URL}/${SUPABASE_APP_STATE_TABLE}`, {
      method: 'POST',
      headers: {
        ...this.getSupabaseHeaders(),
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([
        {
          id: SUPABASE_APP_STATE_ID,
          payload: this.data,
          updated_at: new Date().toISOString(),
        },
      ]),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase save failed: ${response.status} ${detail}`);
    }
  }

  private static createInitialData(): DatabaseSchema {
    return {
      settings: { ...DEFAULT_SETTINGS },
      accessControl: DEFAULT_ACCESS_CONTROL(),
      tables: DEFAULT_TABLES.map((table) => ({ ...table })),
      categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
      products: DEFAULT_PRODUCTS().map((product) => ({
        ...product,
        ingredients: product.ingredients?.map((ingredient) => ({ ...ingredient })),
        allergens: [...(product.allergens || [])],
        optionGroups: product.optionGroups?.map((group) => ({
          ...group,
          choices: group.choices.map((choice) => ({ ...choice })),
        })),
      })),
      ingredients: DEFAULT_INGREDIENTS.map((ingredient) => ({ ...ingredient })),
      orders: DEFAULT_ORDERS.map((order) => ({
        ...order,
        items: order.items.map((item) => ({ ...item })),
      })),
      reviews: DEFAULT_REVIEWS.map((review) => ({ ...review })),
      bills: DEFAULT_BILLS.map((bill) => ({ ...bill, orderIds: [...bill.orderIds] })),
      waiterRequests: [],
    };
  }

  private static load() {
    if (this.data) {
      return;
    }
    throw new Error('DatabaseEngine nu a fost initializat. Apeleaza DatabaseEngine.initialize() inainte de folosire.');
  }

  private static migrateData(raw: Partial<DatabaseSchema>): DatabaseSchema {
    const seed = this.createInitialData();
    const tables = Array.isArray(raw.tables)
      ? raw.tables.map((table) => ({
          id: String(table.id),
          number: Number(table.number),
          status: Object.values(TableStatus).includes(table.status as TableStatus)
            ? (table.status as TableStatus)
            : TableStatus.AVAILABLE,
          activeSessionId: table.activeSessionId,
          name: table.name,
          area: typeof table.area === 'string' && table.area ? table.area : 'INTERIOR',
        }))
      : seed.tables;

    const categories = Array.isArray(raw.categories)
      ? raw.categories.map((category) => ({
          id: String(category.id),
          name: String(category.name),
          icon: String(category.icon || '🍽️'),
          slug: String(category.slug || slugify(String(category.name))),
          active: category.active !== false,
        }))
      : seed.categories;

    const ingredients = Array.isArray(raw.ingredients)
      ? raw.ingredients.map((ingredient) => ({
          id: String(ingredient.id),
          name: String(ingredient.name),
          icon: ingredient.icon ? String(ingredient.icon) : undefined,
        }))
      : seed.ingredients;

    const products = Array.isArray(raw.products)
      ? raw.products.map((product) => ({
          id: String(product.id),
          name: String(product.name),
          description: String(product.description || ''),
          price: Number(product.price || 0),
          imageUrl: String(product.imageUrl || ''),
          rating: Number(product.rating || 5),
          reviewsCount: Number(product.reviewsCount || 0),
          prepTime: Number(product.prepTime || 10),
          isBestseller: Boolean(product.isBestseller),
          categoryId: String(product.categoryId || categories[0]?.id || ''),
          available: product.available !== false,
          ingredients: Array.isArray(product.ingredients)
            ? product.ingredients.map((ingredient) => ({
                id: String(ingredient.id),
                name: String(ingredient.name),
                icon: ingredient.icon ? String(ingredient.icon) : undefined,
              }))
            : [],
          allergens: Array.isArray(product.allergens)
            ? product.allergens.map((allergen) => String(allergen))
            : [],
          nutritionInfo: product.nutritionInfo
            ? {
                ingredientsText: String(product.nutritionInfo.ingredientsText || ''),
                allergenTraceText: product.nutritionInfo.allergenTraceText
                  ? String(product.nutritionInfo.allergenTraceText)
                  : undefined,
                valuesHeading: product.nutritionInfo.valuesHeading
                  ? String(product.nutritionInfo.valuesHeading)
                  : undefined,
                valuesPer100g: Array.isArray(product.nutritionInfo.valuesPer100g)
                  ? product.nutritionInfo.valuesPer100g.map((entry) => ({
                      label: String(entry.label),
                      value: String(entry.value),
                    }))
                  : [],
              }
            : undefined,
          optionGroups: normalizeProductOptionGroups(product.optionGroups),
        }))
      : seed.products;

    const orders = Array.isArray(raw.orders)
      ? raw.orders.map((order, index) => ({
          id: String(order.id || `ord-migrated-${index}`),
          tableId: String(order.tableId),
          tableNumber: Number(order.tableNumber),
          sessionId:
            (typeof order.sessionId === 'string' && order.sessionId) ||
            tables.find((table) => table.id === String(order.tableId))?.activeSessionId ||
            createSessionId(String(order.tableId), getTimestamp(order.createdAt) || Date.now() + index),
          orderNumber: String(order.orderNumber || `ORD-${1000 + index}`),
          status: Object.values(OrderStatus).includes(order.status as OrderStatus)
            ? (order.status as OrderStatus)
            : OrderStatus.PENDING,
          source: Object.values(OrderSource).includes(order.source as OrderSource)
            ? (order.source as OrderSource)
            : OrderSource.CUSTOMER,
          items: Array.isArray(order.items)
            ? order.items.map((item, itemIndex) => normalizeOrderItem(item, `item-${index}-${itemIndex}`))
            : [],
          notes: order.notes ? String(order.notes) : undefined,
          subtotal: Number(order.subtotal || 0),
          createdAt: String(order.createdAt || new Date().toISOString()),
          updatedAt: String(order.updatedAt || order.createdAt || new Date().toISOString()),
          prepTimeEstimate: order.prepTimeEstimate !== undefined ? Number(order.prepTimeEstimate) : undefined,
          approvedAt: order.approvedAt ? String(order.approvedAt) : undefined,
          startedAt: order.startedAt ? String(order.startedAt) : undefined,
          readyAt: order.readyAt ? String(order.readyAt) : undefined,
          completedAt: order.completedAt ? String(order.completedAt) : undefined,
          cancelledAt: order.cancelledAt ? String(order.cancelledAt) : undefined,
          paymentMethod:
            order.paymentMethod === 'CARD' || order.paymentMethod === 'CASH' || order.paymentMethod === 'PROTOCOL'
              ? order.paymentMethod
              : undefined,
          settledAt: order.settledAt ? String(order.settledAt) : undefined,
        }))
      : seed.orders;

    const reviews = Array.isArray(raw.reviews)
      ? raw.reviews.map((review, index) => ({
          id: String(review.id || `rev-${index}`),
          orderId: String(review.orderId || ''),
          productId: review.productId ? String(review.productId) : undefined,
          productName: review.productName ? String(review.productName) : undefined,
          rating: Math.min(5, Math.max(1, Number(review.rating || 5))),
          comment: review.comment ? String(review.comment) : '',
          customerName: review.customerName ? String(review.customerName) : undefined,
          createdAt: String(review.createdAt || new Date().toISOString()),
        }))
      : seed.reviews;

    const bills = Array.isArray(raw.bills)
      ? raw.bills.map((bill, index) => ({
          id: String(bill.id || `bill-${index}`),
          tableId: String(bill.tableId),
          tableNumber: Number(bill.tableNumber),
          sessionId:
            (typeof bill.sessionId === 'string' && bill.sessionId) ||
            orders.find((order) => Array.isArray(bill.orderIds) && bill.orderIds.includes(order.id))?.sessionId ||
            tables.find((table) => table.id === String(bill.tableId))?.activeSessionId ||
            createSessionId(String(bill.tableId), getTimestamp(bill.createdAt) || Date.now() + index),
          orderIds: Array.isArray(bill.orderIds) ? bill.orderIds.map((id) => String(id)) : [],
          status: Object.values(BillStatus).includes(bill.status as BillStatus)
            ? (bill.status as BillStatus)
            : BillStatus.BILL_REQUESTED,
          subtotal: Number(bill.subtotal || 0),
          paymentMethod:
            bill.paymentMethod === 'CARD' || bill.paymentMethod === 'CASH' || bill.paymentMethod === 'PROTOCOL'
              ? bill.paymentMethod
              : ('CASH' as const),
          createdAt: String(bill.createdAt || new Date().toISOString()),
          updatedAt: String(bill.updatedAt || bill.createdAt || new Date().toISOString()),
        }))
      : seed.bills;

    const waiterRequests = Array.isArray(raw.waiterRequests)
      ? raw.waiterRequests.map((request, index) => ({
          id: String(request.id || `waiter-request-${index}`),
          tableId: String(request.tableId || ''),
          tableNumber: Number(request.tableNumber || 0),
          items: Array.isArray(request.items)
            ? request.items.map((item) => ({
                productId: String(item.productId || ''),
                productName: String(item.productName || 'Produs'),
                quantity: Math.max(1, Number(item.quantity || 1)),
                notes: item.notes ? String(item.notes) : undefined,
                selectedOptions: normalizeSelectedOrderOptions(item.selectedOptions),
              }))
            : [],
          notes: request.notes ? String(request.notes) : undefined,
          status: request.status === 'RESOLVED' ? ('RESOLVED' as const) : ('OPEN' as const),
          createdAt: String(request.createdAt || new Date().toISOString()),
          updatedAt: String(request.updatedAt || request.createdAt || new Date().toISOString()),
          resolvedAt: request.resolvedAt ? String(request.resolvedAt) : undefined,
        }))
      : seed.waiterRequests;

    const defaultAccessControl = DEFAULT_ACCESS_CONTROL();

    const migrated: DatabaseSchema = {
      settings: {
        customerOrderingEnabled:
          raw.settings?.customerOrderingEnabled !== undefined
            ? Boolean(raw.settings.customerOrderingEnabled)
            : DEFAULT_SETTINGS.customerOrderingEnabled,
      },
      accessControl: {
        adminUsername:
          typeof raw.accessControl?.adminUsername === 'string' && raw.accessControl.adminUsername.trim()
            ? raw.accessControl.adminUsername.trim()
            : defaultAccessControl.adminUsername,
        adminPasswordHash:
          typeof raw.accessControl?.adminPasswordHash === 'string' && raw.accessControl.adminPasswordHash
            ? raw.accessControl.adminPasswordHash
            : defaultAccessControl.adminPasswordHash,
        waiterPinHash:
          typeof raw.accessControl?.waiterPinHash === 'string' && raw.accessControl.waiterPinHash
            ? raw.accessControl.waiterPinHash
            : typeof (raw as any).settings?.waiterPin === 'string' && String((raw as any).settings.waiterPin).replace(/\D/g, '').slice(0, 8)
              ? createPasswordHash(String((raw as any).settings.waiterPin).replace(/\D/g, '').slice(0, 8))
              : defaultAccessControl.waiterPinHash,
        kitchenPinHash:
          typeof raw.accessControl?.kitchenPinHash === 'string' && raw.accessControl.kitchenPinHash
            ? raw.accessControl.kitchenPinHash
            : defaultAccessControl.kitchenPinHash,
      },
      tables,
      categories,
      products,
      ingredients,
      orders,
      reviews,
      bills,
      waiterRequests,
    };

    this.data = migrated;
    this.compactOpenBills();
    this.recalculateAllTableStatuses();
    return this.data;
  }

  private static save() {
    if (!this.data) {
      return;
    }
    this.writeLocalSnapshot();
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.writeRemoteSnapshot();
        } catch (error) {
          console.error('Nu am putut sincroniza starea in Supabase. Pastrez copia locala.', error);
        }
      });
  }

  private static recalculateAllTableStatuses() {
    if (!this.data) {
      return;
    }

    this.data.tables.forEach((table) => this.recalculateTableStatus(table.id));
  }

  private static compactOpenBills() {
    if (!this.data) {
      return;
    }

    const paidBills = this.data.bills.filter((bill) => bill.status === BillStatus.PAID);
    const openBills = this.data.bills.filter((bill) => bill.status !== BillStatus.PAID);
    const mergedBySession = new Map<string, Bill>();

    openBills
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .forEach((bill) => {
        const key = `${bill.tableId}::${bill.sessionId}`;
        const existing = mergedBySession.get(key);
        if (!existing) {
          mergedBySession.set(key, { ...bill, orderIds: [...bill.orderIds] });
          return;
        }

        const mergedOrderIds = [...new Set([...existing.orderIds, ...bill.orderIds])];
        const mergedOrders =
          this.data?.orders.filter(
            (order) => mergedOrderIds.includes(order.id) && order.status !== OrderStatus.CANCELLED
          ) || [];

        existing.orderIds = mergedOrderIds;
        existing.subtotal = Number(mergedOrders.reduce((sum, order) => sum + order.subtotal, 0).toFixed(2));
        existing.paymentMethod = bill.paymentMethod;
        existing.updatedAt = bill.updatedAt > existing.updatedAt ? bill.updatedAt : existing.updatedAt;
      });

    this.data.bills = [...mergedBySession.values(), ...paidBills].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  private static getLatestKnownSessionId(tableId: string) {
    if (!this.data) {
      return undefined;
    }

    const candidates = [
      ...this.data.orders
        .filter((order) => order.tableId === tableId && order.sessionId)
        .map((order) => ({
          sessionId: order.sessionId,
          timestamp: Math.max(getTimestamp(order.updatedAt), getTimestamp(order.createdAt)),
        })),
      ...this.data.bills
        .filter((bill) => bill.tableId === tableId && bill.sessionId)
        .map((bill) => ({
          sessionId: bill.sessionId,
          timestamp: Math.max(getTimestamp(bill.updatedAt), getTimestamp(bill.createdAt)),
        })),
    ].sort((left, right) => right.timestamp - left.timestamp);

    return candidates[0]?.sessionId;
  }

  private static recalculateTableStatus(tableId: string) {
    if (!this.data) {
      return;
    }

    const table = this.data.tables.find((entry) => entry.id === tableId);
    if (!table) {
      return;
    }

    const openBills = this.data.bills.filter(
      (bill) => bill.tableId === tableId && bill.status !== BillStatus.PAID
    );

    const activeOrders = this.data.orders.filter(
      (order) => order.tableId === tableId && isActiveOrder(order.status)
    );
    const activeSessionId =
      activeOrders
        .slice()
        .sort(
          (left, right) =>
            Math.max(getTimestamp(right.updatedAt), getTimestamp(right.createdAt)) -
            Math.max(getTimestamp(left.updatedAt), getTimestamp(left.createdAt))
        )[0]?.sessionId || undefined;

    if (activeSessionId) {
      table.activeSessionId = activeSessionId;
    }

    if (activeOrders.some((order) => order.status === OrderStatus.READY)) {
      table.status = TableStatus.READY;
      return;
    }

    if (
      activeOrders.some((order) =>
        [OrderStatus.CONFIRMED, OrderStatus.PREPARING].includes(order.status)
      )
    ) {
      table.status = TableStatus.PREPARING;
      return;
    }

    if (activeOrders.some((order) => order.status === OrderStatus.PENDING)) {
      table.status = TableStatus.WAITING;
      return;
    }

    if (openBills.length > 0) {
      table.status = TableStatus.NEEDS_BILL;
      table.activeSessionId =
        openBills
          .slice()
          .sort(
            (left, right) =>
              Math.max(getTimestamp(right.updatedAt), getTimestamp(right.createdAt)) -
              Math.max(getTimestamp(left.updatedAt), getTimestamp(left.createdAt))
          )[0]?.sessionId || table.activeSessionId;
      return;
    }

    if (table.activeSessionId) {
      const sessionOrders = this.data.orders.filter(
        (order) => order.tableId === tableId && order.sessionId === table.activeSessionId
      );
      const hasVisibleSessionHistory = sessionOrders.some(
        (order) => order.status !== OrderStatus.CANCELLED
      );
      const sessionWasPaid = this.data.bills.some(
        (bill) =>
          bill.tableId === tableId &&
          bill.sessionId === table.activeSessionId &&
          bill.status === BillStatus.PAID
      );

      if (hasVisibleSessionHistory && !sessionWasPaid) {
        table.status = TableStatus.WAITING;
        return;
      }
    }

    table.activeSessionId = undefined;
    table.status = TableStatus.AVAILABLE;
  }

  static getTables(): Table[] {
    this.load();
    return [...(this.data?.tables || [])].sort((left, right) => left.number - right.number);
  }

  static getTable(id: string): Table | null {
    this.load();
    return this.data?.tables.find((table) => table.id === id) || null;
  }

  static updateTableStatus(id: string, status: TableStatus): Table {
    this.load();
    const table = this.data?.tables.find((entry) => entry.id === id);
    if (!table) {
      throw new Error('Table not found');
    }

    table.status = status;
    table.activeSessionId = status === TableStatus.AVAILABLE ? undefined : table.activeSessionId || createSessionId(id);
    this.save();
    return table;
  }

  static createTable(number: number, area = 'INTERIOR', name?: string): Table {
    this.load();
    const exists = this.data?.tables.find((table) => table.number === number);
    if (exists) {
      throw new Error('Table already exists');
    }

    const normalizedArea = area === 'TERASA' ? 'TERASA' : 'INTERIOR';

    const table: Table = {
      id: String(number),
      number,
      status: TableStatus.AVAILABLE,
      area: normalizedArea,
      name: name?.trim() || getAreaSequenceLabel(normalizedArea, this.data?.tables || []),
    };

    this.data?.tables.push(table);
    this.save();
    return table;
  }

  static deleteTable(id: string) {
    this.load();
    const table = this.data?.tables.find((entry) => entry.id === id);
    if (!table) {
      throw new Error('Table not found');
    }

    const hasOrders = (this.data?.orders || []).some((order) => order.tableId === id);
    const hasBills = (this.data?.bills || []).some((bill) => bill.tableId === id);
    if (hasOrders || hasBills) {
      throw new Error('Masa are deja istoric de comenzi sau nota si nu poate fi stearsa.');
    }

    this.data!.tables = (this.data?.tables || []).filter((entry) => entry.id !== id);
    this.save();
  }

  static getCategories(): Category[] {
    this.load();
    return this.data?.categories || [];
  }

  static createCategory(name: string, icon: string): Category {
    this.load();
    const category: Category = {
      id: `cat-${Date.now()}`,
      name,
      icon,
      slug: slugify(name),
      active: true,
    };

    this.data?.categories.push(category);
    this.save();
    return category;
  }

  static updateCategory(id: string, name: string, icon: string, active: boolean): Category {
    this.load();
    const category = this.data?.categories.find((entry) => entry.id === id);
    if (!category) {
      throw new Error('Category not found');
    }

    category.name = name;
    category.icon = icon;
    category.active = active;
    category.slug = slugify(name);
    this.save();
    return category;
  }

  static deleteCategory(id: string) {
    this.load();
    if (!this.data) {
      return;
    }

    this.data.categories = this.data.categories.filter((category) => category.id !== id);
    this.save();
  }

  static getProducts(): Product[] {
    this.load();
    return this.data?.products || [];
  }

  static createProduct(product: Omit<Product, 'id'>): Product {
    this.load();
    const created: Product = {
      ...product,
      id: `prod-${Date.now()}`,
      ingredients: product.ingredients?.map((ingredient) => ({ ...ingredient })) || [],
      allergens: [...(product.allergens || [])],
      nutritionInfo: product.nutritionInfo
        ? {
            ingredientsText: product.nutritionInfo.ingredientsText,
            allergenTraceText: product.nutritionInfo.allergenTraceText,
            valuesHeading: product.nutritionInfo.valuesHeading,
            valuesPer100g: product.nutritionInfo.valuesPer100g.map((entry) => ({ ...entry })),
          }
        : undefined,
      optionGroups: normalizeProductOptionGroups(product.optionGroups),
    };

    this.data?.products.push(created);
    this.save();
    return created;
  }

  static updateProduct(id: string, product: Partial<Product>): Product {
    this.load();
    const existing = this.data?.products.find((entry) => entry.id === id);
    if (!existing) {
      throw new Error('Product not found');
    }

    Object.assign(existing, product);
    if (product.ingredients) {
      existing.ingredients = product.ingredients.map((ingredient) => ({ ...ingredient }));
    }
    if (product.allergens) {
      existing.allergens = [...product.allergens];
    }
    if (product.nutritionInfo) {
      existing.nutritionInfo = {
        ingredientsText: product.nutritionInfo.ingredientsText,
        allergenTraceText: product.nutritionInfo.allergenTraceText,
        valuesHeading: product.nutritionInfo.valuesHeading,
        valuesPer100g: product.nutritionInfo.valuesPer100g.map((entry) => ({ ...entry })),
      };
    } else if (product.nutritionInfo === undefined) {
      existing.nutritionInfo = undefined;
    }
    if (product.optionGroups) {
      existing.optionGroups = normalizeProductOptionGroups(product.optionGroups);
    } else if (product.optionGroups === undefined) {
      existing.optionGroups = undefined;
    }
    this.save();
    return existing;
  }

  static deleteProduct(id: string) {
    this.load();
    if (!this.data) {
      return;
    }

    this.data.products = this.data.products.filter((product) => product.id !== id);
    this.save();
  }

  static getOrders(): Order[] {
    this.load();
    return [...(this.data?.orders || [])].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  static getOrder(id: string): Order | null {
    this.load();
    return this.data?.orders.find((order) => order.id === id) || null;
  }

  static createOrder(
    tableId: string,
    items: Omit<OrderItem, 'id'>[],
    notes?: string,
    source: OrderSource = OrderSource.CUSTOMER,
    requestedSessionId?: string
  ): Order {
    this.load();
    if (source === OrderSource.CUSTOMER && !this.data?.settings.customerOrderingEnabled) {
      throw new Error('Comenzile clientilor sunt oprite momentan. Te rugam sa chemi ospatarul.');
    }
    const table = this.getTable(tableId);
    if (!table) {
      throw new Error('Table not found');
    }

    const now = new Date().toISOString();
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const status = source === OrderSource.WAITER ? OrderStatus.CONFIRMED : OrderStatus.PENDING;
    const hasPaidBillForRequestedSession = Boolean(
      requestedSessionId &&
        this.data?.bills.some(
          (bill) =>
            bill.tableId === tableId &&
            bill.sessionId === requestedSessionId &&
            bill.status === BillStatus.PAID
        )
    );

    const sessionId =
      source === OrderSource.CUSTOMER
        ? requestedSessionId && !hasPaidBillForRequestedSession
          ? requestedSessionId
          : createSessionId(tableId)
        : table.status === TableStatus.AVAILABLE || !table.activeSessionId
          ? createSessionId(tableId)
          : table.activeSessionId;

    const normalizedItems = items.map((item, index) => ({
      ...item,
      id: `item-${Date.now()}-${index}`,
      sendToKitchen:
        item.sendToKitchen !== undefined ? item.sendToKitchen : source === OrderSource.WAITER ? true : undefined,
    }));

    const hasKitchenItems = normalizedItems.some((item) => item.sendToKitchen !== false);
    const resolvedStatus =
      status === OrderStatus.CONFIRMED && !hasKitchenItems
        ? OrderStatus.READY
        : status;

    const order: Order = {
      id: `ord-${Date.now()}`,
      tableId,
      tableNumber: table.number,
      sessionId,
      orderNumber: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      status: resolvedStatus,
      source,
      items: normalizedItems,
      notes,
      subtotal: Number(total.toFixed(2)),
      createdAt: now,
      updatedAt: now,
      approvedAt: status === OrderStatus.CONFIRMED ? now : undefined,
      readyAt: resolvedStatus === OrderStatus.READY ? now : undefined,
    };

    this.data?.orders.push(order);
    table.activeSessionId = sessionId;
    this.recalculateTableStatus(tableId);
    this.save();
    return order;
  }

  static updateOrderStatus(
    id: string,
    status: OrderStatus,
    prepTimeEstimate?: number,
    startNewSession = false,
    kitchenItemIds?: string[]
  ): Order {
    this.load();
    const order = this.data?.orders.find((entry) => entry.id === id);
    if (!order) {
      throw new Error('Order not found');
    }

    const now = new Date().toISOString();
    const table = this.data?.tables.find((entry) => entry.id === order.tableId);

    if (startNewSession && status === OrderStatus.CONFIRMED && this.data && table) {
      const previousSessionId = order.sessionId;
      const freshSessionId = createSessionId(order.tableId);

      this.data.orders.forEach((entry) => {
        if (
          entry.tableId === order.tableId &&
          entry.sessionId === previousSessionId &&
          entry.status === OrderStatus.PENDING
        ) {
          entry.sessionId = freshSessionId;
          entry.updatedAt = now;
        }
      });

      table.activeSessionId = freshSessionId;
    }

    if (status === OrderStatus.CONFIRMED && Array.isArray(kitchenItemIds)) {
      const selectedKitchenItems = new Set(kitchenItemIds);
      order.items = order.items.map((item) => ({
        ...item,
        sendToKitchen: selectedKitchenItems.has(item.id),
      }));
    }

    const hasKitchenItems = order.items.some((item) => item.sendToKitchen !== false);
    const resolvedStatus =
      status === OrderStatus.CONFIRMED && !hasKitchenItems
        ? OrderStatus.READY
        : status;

    order.status = resolvedStatus;
    order.updatedAt = now;

    if (prepTimeEstimate !== undefined) {
      order.prepTimeEstimate = prepTimeEstimate;
    }

    if (resolvedStatus === OrderStatus.CONFIRMED) {
      order.approvedAt = now;
    }
    if (resolvedStatus === OrderStatus.PREPARING) {
      order.startedAt = now;
    }
    if (resolvedStatus === OrderStatus.READY) {
      order.approvedAt = order.approvedAt || now;
      order.readyAt = now;
    }
    if (resolvedStatus === OrderStatus.DELIVERED) {
      order.completedAt = now;
    }
    if (resolvedStatus === OrderStatus.CANCELLED) {
      order.cancelledAt = now;
    }

    this.recalculateTableStatus(order.tableId);
    this.save();
    return order;
  }

  static appendItemsToPendingOrder(id: string, items: Omit<OrderItem, 'id'>[]): Order {
    this.load();
    const order = this.data?.orders.find((entry) => entry.id === id);
    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new Error('Doar comenzile aflate in asteptare pot fi completate inainte de confirmare.');
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Trebuie sa trimiti cel putin un produs pentru completare.');
    }

    const now = new Date().toISOString();
    const appendedItems = items.map((item, index) =>
      normalizeOrderItem(item, `item-${Date.now()}-${order.items.length + index}`)
    );

    order.items = [...order.items, ...appendedItems];
    order.subtotal = Number(
      order.items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)
    );
    order.updatedAt = now;

    this.recalculateTableStatus(order.tableId);
    this.save();
    return order;
  }

  static getReviews(): Review[] {
    this.load();
    return [...(this.data?.reviews || [])].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  static createReview(
    orderId: string,
    rating: number,
    comment: string,
    productId?: string,
    productName?: string,
    customerName?: string
  ): Review {
    this.load();

    const review: Review = {
      id: `rev-${Date.now()}`,
      orderId,
      productId,
      productName,
      rating,
      comment,
      customerName: customerName || 'Diner',
      createdAt: new Date().toISOString(),
    };

    this.data?.reviews.push(review);
    this.save();
    return review;
  }

  static getBills(): Bill[] {
    this.load();
    return [...(this.data?.bills || [])].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  static requestBill(tableId: string, orderIds: string[], paymentMethod: 'CARD' | 'CASH'): Bill {
    this.load();
    const table = this.data?.tables.find((entry) => entry.id === tableId);
    if (!table) {
      throw new Error('Table not found');
    }

    const normalizedOrderIds = [...new Set(orderIds.map((id) => String(id)))];
    const orders =
      this.data?.orders.filter(
        (order) => normalizedOrderIds.includes(order.id) && order.status !== OrderStatus.CANCELLED
      ) || [];

    if (orders.length === 0) {
      throw new Error('No payable orders found for this table');
    }

    const sessionId =
      orders
        .slice()
        .sort((left, right) => getTimestamp(right.createdAt) - getTimestamp(left.createdAt))[0]
        ?.sessionId ||
      table.activeSessionId ||
      createSessionId(tableId);

    const existingOpenBill = this.data?.bills.find(
      (bill) => bill.tableId === tableId && bill.sessionId === sessionId && bill.status !== BillStatus.PAID
    );

    const now = new Date().toISOString();

    if (existingOpenBill) {
      existingOpenBill.orderIds = [...new Set([...existingOpenBill.orderIds, ...normalizedOrderIds])];
      const existingBillOrders =
        this.data?.orders.filter(
          (order) =>
            existingOpenBill.orderIds.includes(order.id) && order.status !== OrderStatus.CANCELLED
        ) || [];
      existingOpenBill.subtotal = Number(
        existingBillOrders.reduce((sum, order) => sum + order.subtotal, 0).toFixed(2)
      );
      existingOpenBill.paymentMethod = paymentMethod;
      existingOpenBill.updatedAt = now;
      this.recalculateTableStatus(tableId);
      this.save();
      return existingOpenBill;
    }

    const subtotal = orders.reduce((sum, order) => sum + order.subtotal, 0);

    const bill: Bill = {
      id: `bill-${Date.now()}`,
      tableId,
      tableNumber: table.number,
      sessionId,
      orderIds: normalizedOrderIds,
      status: BillStatus.BILL_REQUESTED,
      subtotal: Number(subtotal.toFixed(2)),
      paymentMethod,
      createdAt: now,
      updatedAt: now,
    };

    this.data?.bills.push(bill);
    this.recalculateTableStatus(tableId);
    this.save();
    return bill;
  }

  static updateBillStatus(id: string, status: BillStatus): Bill {
    this.load();
    const bill = this.data?.bills.find((entry) => entry.id === id);
    if (!bill) {
      throw new Error('Bill not found');
    }

    const now = new Date().toISOString();
    bill.status = status;
    bill.updatedAt = now;

    if (status === BillStatus.PAID && this.data) {
      this.data.bills.forEach((entry) => {
        if (
          entry.tableId === bill.tableId &&
          entry.sessionId === bill.sessionId &&
          entry.status !== BillStatus.PAID
        ) {
          entry.status = BillStatus.PAID;
          entry.updatedAt = now;
        }
      });
    }

    this.recalculateTableStatus(bill.tableId);
    this.save();
    return bill;
  }

  static settleTableSession(tableId: string, paymentMethod: PaymentMethod) {
    this.load();
    const table = this.data?.tables.find((entry) => entry.id === tableId);
    if (!table || !this.data) {
      throw new Error('Table not found');
    }

    const sessionId = table.activeSessionId || this.getLatestKnownSessionId(tableId);
    if (!sessionId) {
      throw new Error('Nu exista o sesiune activa de inchis pentru aceasta masa.');
    }

    const sessionOrders = this.data.orders.filter(
      (order) => order.tableId === tableId && order.sessionId === sessionId && order.status !== OrderStatus.CANCELLED
    );

    if (sessionOrders.length === 0) {
      throw new Error('Nu exista comenzi pe aceasta sesiune.');
    }

    if (sessionOrders.some((order) => order.status !== OrderStatus.DELIVERED)) {
      throw new Error('Mai exista comenzi active pe aceasta masa. Finalizeaza-le inainte de incasare.');
    }

    const unsettledOrders = sessionOrders.filter((order) => !order.settledAt);
    if (unsettledOrders.length === 0) {
      throw new Error('Aceasta sesiune a fost deja inchisa.');
    }

    const now = new Date().toISOString();

    unsettledOrders.forEach((order) => {
      order.paymentMethod = paymentMethod;
      order.settledAt = now;
      order.updatedAt = now;
    });

    this.data.bills.forEach((bill) => {
      if (bill.tableId === tableId && bill.sessionId === sessionId) {
        bill.paymentMethod = paymentMethod;
        bill.status = BillStatus.PAID;
        bill.updatedAt = now;
      }
    });

    table.activeSessionId = undefined;
    table.status = TableStatus.AVAILABLE;

    this.save();
    return {
      table: { ...table },
      sessionId,
      settledOrders: unsettledOrders.map((order) => ({
        ...order,
        items: order.items.map((item) => ({ ...item })),
      })),
    };
  }

  static getStats(): SystemStats {
    this.load();

    const now = new Date();
    const orders = this.data?.orders || [];
    const products = this.data?.products || [];
    const tables = this.data?.tables || [];
    const reviews = this.data?.reviews || [];
    const deliveredOrders = orders.filter((order) => order.status === OrderStatus.DELIVERED);
    const revenueOrders = deliveredOrders.filter((order) => order.paymentMethod !== 'PROTOCOL');

    const isSameDay = (value: string) => {
      const date = new Date(value);
      return (
        date.getUTCFullYear() === now.getUTCFullYear() &&
        date.getUTCMonth() === now.getUTCMonth() &&
        date.getUTCDate() === now.getUTCDate()
      );
    };

    const isThisWeek = (value: string) => now.getTime() - new Date(value).getTime() <= 7 * 24 * 60 * 60 * 1000;
    const isThisMonth = (value: string) => {
      const date = new Date(value);
      return date.getUTCMonth() === now.getUTCMonth() && date.getUTCFullYear() === now.getUTCFullYear();
    };

    const revenueToday = revenueOrders
      .filter((order) => isSameDay(order.settledAt || order.completedAt || order.createdAt))
      .reduce((sum, order) => sum + order.subtotal, 0);
    const revenueThisWeek = revenueOrders
      .filter((order) => isThisWeek(order.settledAt || order.completedAt || order.createdAt))
      .reduce((sum, order) => sum + order.subtotal, 0);
    const revenueThisMonth = revenueOrders
      .filter((order) => isThisMonth(order.settledAt || order.completedAt || order.createdAt))
      .reduce((sum, order) => sum + order.subtotal, 0);

    const activeOrders = orders.filter((order) => isActiveOrder(order.status)).length;
    const activeTablesCount = tables.filter((table) => table.status !== TableStatus.AVAILABLE).length;
    const avgOrderValue = revenueOrders.length
      ? revenueOrders.reduce((sum, order) => sum + order.subtotal, 0) / revenueOrders.length
      : 0;
    const kitchenTimedOrders = deliveredOrders.filter((order) => order.startedAt && order.completedAt);
    const avgKitchenTimeMinutes = kitchenTimedOrders.length
      ? kitchenTimedOrders.reduce((sum, order) => {
          const startedAt = new Date(order.startedAt as string).getTime();
          const completedAt = new Date(order.completedAt as string).getTime();
          const durationMinutes = Math.max(0, (completedAt - startedAt) / 60000);
          return sum + durationMinutes;
        }, 0) / kitchenTimedOrders.length
      : 0;

    const productCounts: Record<string, { name: string; count: number; image: string }> = {};
    orders.forEach((order) => {
      order.items.forEach((item) => {
        const product = products.find((entry) => entry.id === item.productId);
        if (!product) {
          return;
        }

        if (!productCounts[product.id]) {
          productCounts[product.id] = {
            name: product.name,
            count: 0,
            image: product.imageUrl,
          };
        }

        productCounts[product.id].count += item.quantity;
      });
    });

    let mostSoldProduct: { name: string; count: number; image: string } | null = null;
    Object.values(productCounts).forEach((product) => {
      if (!mostSoldProduct || product.count > mostSoldProduct.count) {
        mostSoldProduct = product;
      }
    });

    let bestRatedProduct: { name: string; rating: number; count: number } | null = null;
    if (products.length > 0) {
      const sortedProducts = [...products].sort((left, right) => right.rating - left.rating);
      const product = sortedProducts[0];
      if (product) {
        bestRatedProduct = {
          name: product.name,
          rating: product.rating,
          count: product.reviewsCount,
        };
      }
    }

    return {
      revenueToday: Number(revenueToday.toFixed(2)),
      revenueThisWeek: Number(revenueThisWeek.toFixed(2)),
      revenueThisMonth: Number(revenueThisMonth.toFixed(2)),
      activeOrders,
      activeTablesCount,
      avgOrderValue: Number(avgOrderValue.toFixed(2)),
      avgKitchenTimeMinutes: Number(avgKitchenTimeMinutes.toFixed(1)),
      mostSoldProduct,
      bestRatedProduct,
    };
  }

  static getWaiterRequests(): WaiterRequest[] {
    this.load();
    return [...(this.data?.waiterRequests || [])].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  static createWaiterRequest(
    tableId: string,
    items: { productId: string; productName: string; quantity: number; notes?: string; selectedOptions?: OrderItem['selectedOptions'] }[],
    notes?: string
  ): WaiterRequest {
    this.load();
    const table = this.getTable(tableId);
    if (!table) {
      throw new Error('Table not found');
    }

    const now = new Date().toISOString();
    const request: WaiterRequest = {
      id: `waiter-request-${Date.now()}`,
      tableId,
      tableNumber: table.number,
      items: items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: Math.max(1, Number(item.quantity || 1)),
        notes: item.notes,
        selectedOptions: normalizeSelectedOrderOptions(item.selectedOptions),
      })),
      notes,
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    };

    this.data?.waiterRequests.push(request);
    this.save();
    return request;
  }

  static resolveWaiterRequest(id: string): WaiterRequest {
    this.load();
    const request = this.data?.waiterRequests.find((entry) => entry.id === id);
    if (!request) {
      throw new Error('Waiter request not found');
    }

    const now = new Date().toISOString();
    request.status = 'RESOLVED';
    request.updatedAt = now;
    request.resolvedAt = now;
    this.save();
    return request;
  }

  static resetOperationalData() {
    this.load();

    const clearedAt = new Date().toISOString();
    const cleared = {
      orders: this.data?.orders.length || 0,
      bills: this.data?.bills.length || 0,
      reviews: this.data?.reviews.length || 0,
      waiterRequests: this.data?.waiterRequests.length || 0,
      activeTableSessions: (this.data?.tables || []).filter((table) => table.activeSessionId).length,
    };

    if (this.data) {
      this.data.orders = [];
      this.data.bills = [];
      this.data.reviews = [];
      this.data.waiterRequests = [];
      this.data.tables = this.data.tables.map((table) => ({
        ...table,
        status: TableStatus.AVAILABLE,
        activeSessionId: undefined,
      }));
    }

    this.save();

    return {
      clearedAt,
      cleared,
      preserved: ['settings', 'accessControl', 'tables', 'categories', 'products', 'ingredients'],
    };
  }

  static getSettings(): RestaurantSettings {
    this.load();
    return {
      customerOrderingEnabled: this.data?.settings.customerOrderingEnabled ?? DEFAULT_SETTINGS.customerOrderingEnabled,
    };
  }

  static updateSettings(settings: Partial<RestaurantSettings>): RestaurantSettings {
    this.load();
    if (!this.data) {
      this.data = this.createInitialData();
    }

    this.data.settings = {
      ...this.data.settings,
      ...(settings.customerOrderingEnabled !== undefined
        ? { customerOrderingEnabled: Boolean(settings.customerOrderingEnabled) }
        : {}),
    };
    this.save();
    return this.getSettings();
  }

  static getAccessControlSummary() {
    this.load();
    const accessControl = this.data?.accessControl || DEFAULT_ACCESS_CONTROL();
    return {
      adminUsername: accessControl.adminUsername,
      adminPasswordConfigured: Boolean(accessControl.adminPasswordHash),
      waiterPinConfigured: Boolean(accessControl.waiterPinHash),
      kitchenPinConfigured: Boolean(accessControl.kitchenPinHash),
    };
  }

  static updateAccessControl(payload: {
    adminUsername?: string;
    adminPassword?: string;
    waiterPin?: string;
    kitchenPin?: string;
  }) {
    this.load();
    if (!this.data) {
      this.data = this.createInitialData();
    }

    const current = this.data.accessControl || DEFAULT_ACCESS_CONTROL();
    const nextAdminUsername =
      typeof payload.adminUsername === 'string' && payload.adminUsername.trim()
        ? payload.adminUsername.trim()
        : current.adminUsername;

    this.data.accessControl = {
      adminUsername: nextAdminUsername,
      adminPasswordHash:
        typeof payload.adminPassword === 'string' && payload.adminPassword.trim().length >= 6
          ? createPasswordHash(payload.adminPassword)
          : current.adminPasswordHash,
      waiterPinHash:
        typeof payload.waiterPin === 'string' && payload.waiterPin.replace(/\D/g, '').length >= 4
          ? createPasswordHash(payload.waiterPin.replace(/\D/g, '').slice(0, 8))
          : current.waiterPinHash,
      kitchenPinHash:
        typeof payload.kitchenPin === 'string' && payload.kitchenPin.replace(/\D/g, '').length >= 4
          ? createPasswordHash(payload.kitchenPin.replace(/\D/g, '').slice(0, 8))
          : current.kitchenPinHash,
    };

    this.save();
    return this.getAccessControlSummary();
  }

  static verifyAccessRole(
    role: AccessRole,
    payload: { username?: string; password?: string; pin?: string }
  ) {
    this.load();
    const accessControl = this.data?.accessControl || DEFAULT_ACCESS_CONTROL();

    if (role === 'ADMIN') {
      const normalizedUsername = String(payload.username || '').trim();
      const password = String(payload.password || '');
      return (
        normalizedUsername.toLowerCase() === accessControl.adminUsername.trim().toLowerCase() &&
        verifyPasswordHash(password, accessControl.adminPasswordHash)
      );
    }

    const normalizedPin = String(payload.pin || '').replace(/\D/g, '').slice(0, 8);
    if (!normalizedPin) {
      return false;
    }

    if (role === 'WAITER') {
      return verifyPasswordHash(normalizedPin, accessControl.waiterPinHash);
    }

    return verifyPasswordHash(normalizedPin, accessControl.kitchenPinHash);
  }
}
