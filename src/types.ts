export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum OrderSource {
  CUSTOMER = 'CUSTOMER',
  WAITER = 'WAITER',
}

export enum TableStatus {
  AVAILABLE = 'AVAILABLE',
  WAITING = 'WAITING',     // Customer seated / looking at menu
  PREPARING = 'PREPARING', // Active order cooking
  READY = 'READY',         // Order ready for delivery
  NEEDS_BILL = 'NEEDS_BILL', // Bill requested
}

export enum BillStatus {
  BILL_REQUESTED = 'BILL_REQUESTED',
  BILL_SENT = 'BILL_SENT',
  PAID = 'PAID',
}

export type PaymentMethod = 'CASH' | 'CARD' | 'PROTOCOL';

export interface Table {
  id: string; // e.g., '1', '2'
  number: number;
  status: TableStatus;
  activeSessionId?: string;
  name?: string;
  area?: 'INTERIOR' | 'TERASA' | string;
}

export interface Category {
  id: string;
  name: string;
  icon: string; // Lucide icon name or emoji
  slug: string;
  active: boolean;
}

export interface Ingredient {
  id: string;
  name: string;
  icon?: string;
}

export interface NutritionValue {
  label: string;
  value: string;
}

export interface ProductNutritionInfo {
  ingredientsText: string;
  allergenTraceText?: string;
  valuesHeading?: string;
  valuesPer100g: NutritionValue[];
}

export interface ProductOptionChoice {
  id: string;
  name: string;
  priceDelta: number;
}

export interface ProductOptionGroup {
  id: string;
  name: string;
  required: boolean;
  selectionType: 'single' | 'multiple';
  maxSelections?: number;
  choices: ProductOptionChoice[];
}

export interface SelectedOrderOption {
  groupId: string;
  groupName: string;
  choiceId: string;
  choiceName: string;
  priceDelta: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  rating: number;
  reviewsCount: number;
  prepTime: number; // in minutes
  isBestseller: boolean;
  categoryId: string;
  available: boolean;
  ingredients?: Ingredient[];
  allergens?: string[];
  nutritionInfo?: ProductNutritionInfo;
  optionGroups?: ProductOptionGroup[];
}

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  notes?: string;
  selectedOptions?: SelectedOrderOption[];
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  notes?: string;
  sendToKitchen?: boolean;
  selectedOptions?: SelectedOrderOption[];
}

export interface Order {
  id: string;
  tableId: string;
  tableNumber: number;
  sessionId: string;
  orderNumber: string; // short unique code, e.g. "ORD-4820"
  status: OrderStatus;
  source: OrderSource;
  items: OrderItem[];
  notes?: string;
  subtotal: number;
  createdAt: string;
  updatedAt: string;
  prepTimeEstimate?: number; // in mins
  approvedAt?: string;
  startedAt?: string;
  readyAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  paymentMethod?: PaymentMethod;
  settledAt?: string;
}

export interface Review {
  id: string;
  orderId: string;
  productId?: string;
  productName?: string;
  rating: number; // 1-5
  comment: string;
  customerName?: string;
  createdAt: string;
}

export interface Bill {
  id: string;
  tableId: string;
  tableNumber: number;
  sessionId: string;
  orderIds: string[];
  status: BillStatus;
  subtotal: number;
  paymentMethod?: PaymentMethod;
  createdAt: string;
  updatedAt: string;
}

export interface TableSettlementResult {
  table: Table;
  sessionId: string;
  settledOrders: Order[];
}

export interface WaiterRequestItem {
  productId: string;
  productName: string;
  quantity: number;
  notes?: string;
  selectedOptions?: SelectedOrderOption[];
}

export interface WaiterRequest {
  id: string;
  tableId: string;
  tableNumber: number;
  items: WaiterRequestItem[];
  notes?: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface RestaurantSettings {
  customerOrderingEnabled: boolean;
}

export type InternalRole = 'ADMIN' | 'WAITER' | 'KITCHEN';

export interface AuthSessionInfo {
  authenticated: boolean;
  role?: InternalRole;
  username?: string;
}

export interface AccessControlSummary {
  adminUsername: string;
  adminPasswordConfigured: boolean;
  waiterPinConfigured: boolean;
  kitchenPinConfigured: boolean;
}

export interface ResetOperationalDataResult {
  clearedAt: string;
  cleared: {
    orders: number;
    bills: number;
    reviews: number;
    waiterRequests: number;
    activeTableSessions: number;
  };
  preserved: string[];
}

export interface SystemStats {
  revenueToday: number;
  revenueThisWeek: number;
  revenueThisMonth: number;
  activeOrders: number;
  activeTablesCount: number;
  avgOrderValue: number;
  avgKitchenTimeMinutes: number;
  mostSoldProduct: { name: string; count: number; image: string } | null;
  bestRatedProduct: { name: string; rating: number; count: number } | null;
}
