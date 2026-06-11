import { Table, Category, Product, Order, Bill, Review, RestaurantSettings, SystemStats, TableStatus, OrderStatus, BillStatus, OrderSource, WaiterRequest, PaymentMethod, TableSettlementResult, SelectedOrderOption, AccessControlSummary, AuthSessionInfo, InternalRole, ResetOperationalDataResult, TableSessionClearResult } from '../types.js';

// Determine base API url dynamically
const BASE_URL = '';

type EventCallback = (data: any) => void;

class ApiClient {
  private eventListeners: Record<string, EventCallback[]> = {};
  private eventSource: EventSource | null = null;
  private reconnectTimeout: any = null;

  constructor() {
  }

  private initSSE() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const sseUrl = `${BASE_URL}/api/realtime`;
    console.log('Establishing Realtime connection to:', sseUrl);
    
    this.eventSource = new EventSource(sseUrl);

    this.eventSource.addEventListener('open', () => {
      console.log('Realtime pipeline successfully opened');
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
    });

    // Handle incoming events from SSE channel
    const eventTypes = ['new-order', 'new-order-request', 'order-update', 'table-update', 'table-delete', 'bill-update', 'new-review', 'menu-update', 'settings-update', 'new-waiter-request', 'waiter-request-update', 'database-reset', 'session-cleared', 'ping'];
    eventTypes.forEach(type => {
      this.eventSource?.addEventListener(type, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this.triggerListeners(type, data);
        } catch (e) {
          this.triggerListeners(type, event.data);
        }
      });
    });

    this.eventSource.onerror = (err) => {
      console.warn('Realtime pipeline disconnected, scheduling reconnect...');
      this.eventSource?.close();
      this.eventSource = null;
      
      // Attempt reconnect in 4 seconds
      if (!this.reconnectTimeout) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.initSSE();
        }, 4000);
      }
    };
  }

  // Subscribe to real-time events
  subscribe(type: string, callback: EventCallback): () => void {
    if (typeof window !== 'undefined' && !this.eventSource) {
      this.initSSE();
    }

    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(callback);

    // Return unsubscribe clean-up function
    return () => {
      this.eventListeners[type] = this.eventListeners[type].filter(cb => cb !== callback);
    };
  }

  private triggerListeners(type: string, data: any) {
    const listeners = this.eventListeners[type] || [];
    listeners.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        console.error(`Error in EventSource callback for ${type}:`, e);
      }
    });
  }

  // API Call Wrapper helper
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {})
      }
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP error ${response.status} failed`);
    }

    return response.json();
  }

  // Tables
  getTables(): Promise<Table[]> {
    return this.request<Table[]>('/api/tables');
  }

  getTable(id: string): Promise<Table> {
    return this.request<Table>(`/api/tables/${id}`);
  }

  createTable(number: number, area?: 'INTERIOR' | 'TERASA', name?: string): Promise<Table> {
    return this.request<Table>('/api/tables', {
      method: 'POST',
      body: JSON.stringify({ number, area, name })
    });
  }

  deleteTable(id: string): Promise<{ success: true; id: string }> {
    return this.request<{ success: true; id: string }>(`/api/tables/${id}`, {
      method: 'DELETE'
    });
  }

  updateTableStatus(id: string, status: TableStatus): Promise<Table> {
    return this.request<Table>(`/api/tables/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
  }

  clearTableSession(id: string): Promise<TableSessionClearResult> {
    return this.request<TableSessionClearResult>(`/api/tables/${id}/clear-session`, {
      method: 'POST'
    });
  }

  // Categories
  getCategories(): Promise<Category[]> {
    return this.request<Category[]>('/api/categories');
  }

  createCategory(name: string, icon: string): Promise<Category> {
    return this.request<Category>('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name, icon })
    });
  }

  updateCategory(id: string, name: string, icon: string, active: boolean): Promise<Category> {
    return this.request<Category>(`/api/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, icon, active })
    });
  }

  deleteCategory(id: string): Promise<void> {
    return this.request<void>(`/api/categories/${id}`, {
      method: 'DELETE'
    });
  }

  // Products
  getProducts(): Promise<Product[]> {
    return this.request<Product[]>('/api/products');
  }

  createProduct(product: Omit<Product, 'id'>): Promise<Product> {
    return this.request<Product>('/api/products', {
      method: 'POST',
      body: JSON.stringify(product)
    });
  }

  updateProduct(id: string, product: Partial<Product>): Promise<Product> {
    return this.request<Product>(`/api/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(product)
    });
  }

  deleteProduct(id: string): Promise<void> {
    return this.request<void>(`/api/products/${id}`, {
      method: 'DELETE'
    });
  }

  // Orders
  getOrders(): Promise<Order[]> {
    return this.request<Order[]>('/api/orders');
  }

  createOrder(
    tableId: string,
    items: { productId: string; productName: string; price: number; quantity: number; notes?: string; sendToKitchen?: boolean; selectedOptions?: SelectedOrderOption[] }[],
    notes?: string,
    source: OrderSource = OrderSource.CUSTOMER,
    sessionId?: string
  ): Promise<Order> {
    return this.request<Order>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ tableId, items, notes, source, sessionId })
    });
  }

  updateOrderStatus(
    id: string,
    status: OrderStatus,
    prepTimeEstimate?: number,
    startNewSession?: boolean,
    kitchenItemIds?: string[]
  ): Promise<Order> {
    return this.request<Order>(`/api/orders/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, prepTimeEstimate, startNewSession, kitchenItemIds })
    });
  }

  appendItemsToPendingOrder(
    id: string,
    items: { productId: string; productName: string; price: number; quantity: number; notes?: string; sendToKitchen?: boolean; selectedOptions?: SelectedOrderOption[] }[]
  ): Promise<Order> {
    return this.request<Order>(`/api/orders/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ items })
    });
  }

  // Bills
  getBills(): Promise<Bill[]> {
    return this.request<Bill[]>('/api/bills');
  }

  requestBill(tableId: string, orderIds: string[], paymentMethod: 'CARD' | 'CASH'): Promise<Bill> {
    return this.request<Bill>('/api/bills/request', {
      method: 'POST',
      body: JSON.stringify({ tableId, orderIds, paymentMethod })
    });
  }

  settleTableSession(tableId: string, paymentMethod: PaymentMethod): Promise<TableSettlementResult> {
    return this.request<TableSettlementResult>(`/api/tables/${tableId}/settle`, {
      method: 'POST',
      body: JSON.stringify({ paymentMethod })
    });
  }

  updateBillStatus(id: string, status: BillStatus): Promise<Bill> {
    return this.request<Bill>(`/api/bills/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
  }

  getWaiterRequests(): Promise<WaiterRequest[]> {
    return this.request<WaiterRequest[]>('/api/waiter-requests');
  }

  createWaiterRequest(
    tableId: string,
    items: { productId: string; productName: string; quantity: number; notes?: string; selectedOptions?: SelectedOrderOption[] }[],
    notes?: string
  ): Promise<WaiterRequest> {
    return this.request<WaiterRequest>('/api/waiter-requests', {
      method: 'POST',
      body: JSON.stringify({ tableId, items, notes })
    });
  }

  resolveWaiterRequest(id: string): Promise<WaiterRequest> {
    return this.request<WaiterRequest>(`/api/waiter-requests/${id}/resolve`, {
      method: 'POST'
    });
  }

  // Reviews
  getReviews(): Promise<Review[]> {
    return this.request<Review[]>('/api/reviews');
  }

  createReview(orderId: string, rating: number, comment: string, productId?: string, productName?: string, customerName?: string): Promise<Review> {
    return this.request<Review>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({ orderId, rating, comment, productId, productName, customerName })
    });
  }

  // Stats
  getStats(): Promise<SystemStats> {
    return this.request<SystemStats>('/api/stats');
  }

  getSettings(): Promise<RestaurantSettings> {
    return this.request<RestaurantSettings>('/api/settings');
  }

  updateSettings(settings: Partial<RestaurantSettings>): Promise<RestaurantSettings> {
    return this.request<RestaurantSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  }

  resetOperationalData(): Promise<ResetOperationalDataResult> {
    return this.request<ResetOperationalDataResult>('/api/admin/reset-operational-data', {
      method: 'POST'
    });
  }

  login(role: InternalRole, payload: { username?: string; password?: string; pin?: string }): Promise<AuthSessionInfo> {
    return this.request<AuthSessionInfo>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ role, ...payload })
    });
  }

  getAuthSession(): Promise<AuthSessionInfo> {
    return this.request<AuthSessionInfo>('/api/auth/session');
  }

  logout(): Promise<{ success: true }> {
    return this.request<{ success: true }>('/api/auth/logout', {
      method: 'POST'
    });
  }

  getAccessControlSummary(): Promise<AccessControlSummary> {
    return this.request<AccessControlSummary>('/api/access-control');
  }

  updateAccessControl(payload: {
    adminUsername?: string;
    adminPassword?: string;
    waiterPin?: string;
    kitchenPin?: string;
  }): Promise<AccessControlSummary> {
    return this.request<AccessControlSummary>('/api/access-control', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }
}

export const api = new ApiClient();
