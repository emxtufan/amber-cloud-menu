import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { DatabaseEngine } from './server_db.js';
import { OrderSource, OrderStatus, TableStatus, BillStatus, PaymentMethod, InternalRole, TableSessionClearResult } from './src/types.js';

let sseClients: Response[] = [];
const AUTH_COOKIE_NAME = 'restaurant_internal_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface AuthSessionRecord {
  id: string;
  role: InternalRole;
  username?: string;
  expiresAt: number;
}

const authSessions = new Map<string, AuthSessionRecord>();

// Broadcast changes to active SSE clients
function broadcastEvent(type: string, data: any) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(payload);
    } catch (e) {
      console.error('Failed to write to SSE client, connection probably closed');
    }
  });
}

function parseCookies(req: Request) {
  const rawCookieHeader = req.headers.cookie || '';
  return rawCookieHeader.split(';').reduce<Record<string, string>>((accumulator, chunk) => {
    const [rawKey, ...rawValueParts] = chunk.trim().split('=');
    if (!rawKey) {
      return accumulator;
    }

    accumulator[rawKey] = decodeURIComponent(rawValueParts.join('=') || '');
    return accumulator;
  }, {});
}

function setAuthCookie(res: Response, sessionId: string) {
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000
    )}; SameSite=Lax`
  );
}

function clearAuthCookie(res: Response) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function readAuthSession(req: Request) {
  const cookies = parseCookies(req);
  const sessionId = cookies[AUTH_COOKIE_NAME];
  if (!sessionId) {
    return null;
  }

  const session = authSessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    authSessions.delete(sessionId);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function requireAuth(allowedRoles: InternalRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = readAuthSession(req);
    if (!session || !allowedRoles.includes(session.role)) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Autentificare necesara.' });
    }

    next();
  };
}

async function startServer() {
  await DatabaseEngine.initialize();

  const app = express();
  const PORT = process.env.PORT ? Number(process.env.PORT) : 5595;

  app.use(express.json());

  // Error logging middleware helper
  const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  // Real-Time SSE Endpoint
  app.get('/api/realtime', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial test event to acknowledge connection
    res.write('event: ping\ndata: connected\n\n');

    sseClients.push(res);

    req.on('close', () => {
      sseClients = sseClients.filter(client => client !== res);
    });
  });

  app.post('/api/auth/login', asyncHandler(async (req: Request, res: Response) => {
    const { role, username, password, pin } = req.body || {};
    if (role !== 'ADMIN' && role !== 'WAITER' && role !== 'KITCHEN') {
      return res.status(400).json({ error: 'Rol invalid.' });
    }

    const isValid = DatabaseEngine.verifyAccessRole(role, {
      username: typeof username === 'string' ? username : undefined,
      password: typeof password === 'string' ? password : undefined,
      pin: typeof pin === 'string' ? pin : undefined,
    });

    if (!isValid) {
      clearAuthCookie(res);
      return res.status(401).json({
        error: role === 'ADMIN' ? 'Date de autentificare invalide.' : 'PIN invalid.',
      });
    }

    const accessSummary = DatabaseEngine.getAccessControlSummary();
    const sessionId = crypto.randomUUID();
    authSessions.set(sessionId, {
      id: sessionId,
      role,
      username: role === 'ADMIN' ? accessSummary.adminUsername : undefined,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    setAuthCookie(res, sessionId);

    res.json({
      authenticated: true,
      role,
      username: role === 'ADMIN' ? accessSummary.adminUsername : undefined,
    });
  }));

  app.get('/api/auth/session', asyncHandler((req: Request, res: Response) => {
    const session = readAuthSession(req);
    if (!session) {
      clearAuthCookie(res);
      return res.json({ authenticated: false });
    }

    setAuthCookie(res, session.id);
    res.json({
      authenticated: true,
      role: session.role,
      username: session.username,
    });
  }));

  app.post('/api/auth/logout', asyncHandler((req: Request, res: Response) => {
    const session = readAuthSession(req);
    if (session) {
      authSessions.delete(session.id);
    }

    clearAuthCookie(res);
    res.json({ success: true });
  }));

  // Table API Routes
  app.get('/api/tables', asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getTables());
  }));

  app.get('/api/tables/:id', asyncHandler((req: Request, res: Response) => {
    const table = DatabaseEngine.getTable(req.params.id);
    if (!table) return res.status(404).json({ error: 'Table not found' });
    res.json(table);
  }));

  app.post('/api/tables', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    const { number, area, name } = req.body;
    if (!number) return res.status(400).json({ error: 'Table number is required' });
    const table = DatabaseEngine.createTable(Number(number), area, name);
    await DatabaseEngine.flush();
    broadcastEvent('table-update', table);
    res.status(201).json(table);
  }));

  app.delete('/api/tables/:id', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    DatabaseEngine.deleteTable(req.params.id);
    await DatabaseEngine.flush();
    broadcastEvent('table-delete', { id: req.params.id });
    res.json({ success: true, id: req.params.id });
  }));

  app.post('/api/tables/:id/status', requireAuth(['ADMIN', 'WAITER']), asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });
    const table = DatabaseEngine.updateTableStatus(req.params.id, status as TableStatus);
    await DatabaseEngine.flush();
    broadcastEvent('table-update', table);
    res.json(table);
  }));

  app.post('/api/tables/:id/clear-session', requireAuth(['ADMIN', 'WAITER']), asyncHandler(async (req: Request, res: Response) => {
    const result = DatabaseEngine.clearTableSession(req.params.id) as TableSessionClearResult;
    await DatabaseEngine.flush();
    broadcastEvent('table-update', result.table);
    broadcastEvent('session-cleared', result);
    res.json(result);
  }));

  app.post('/api/tables/:id/settle', requireAuth(['ADMIN', 'WAITER']), asyncHandler(async (req: Request, res: Response) => {
    const { paymentMethod } = req.body;
    if (!paymentMethod) return res.status(400).json({ error: 'paymentMethod is required' });
    const settlement = DatabaseEngine.settleTableSession(req.params.id, paymentMethod as PaymentMethod);
    await DatabaseEngine.flush();
    broadcastEvent('table-update', settlement.table);
    settlement.settledOrders.forEach((order) => {
      broadcastEvent('order-update', order);
    });
    res.json(settlement);
  }));

  // Categories API Routes
  app.get('/api/categories', asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getCategories());
  }));

  app.post('/api/categories', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    const { name, icon } = req.body;
    if (!name || !icon) return res.status(400).json({ error: 'Name and icon are required' });
    const cat = DatabaseEngine.createCategory(name, icon);
    await DatabaseEngine.flush();
    broadcastEvent('menu-update', { type: 'category_created', category: cat });
    res.status(201).json(cat);
  }));

  app.put('/api/categories/:id', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    const { name, icon, active } = req.body;
    const cat = DatabaseEngine.updateCategory(req.params.id, name, icon, active);
    await DatabaseEngine.flush();
    broadcastEvent('menu-update', { type: 'category_updated', category: cat });
    res.json(cat);
  }));

  app.delete('/api/categories/:id', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    DatabaseEngine.deleteCategory(req.params.id);
    await DatabaseEngine.flush();
    broadcastEvent('menu-update', { type: 'category_deleted', id: req.params.id });
    res.json({ success: true });
  }));

  // Products API Routes
  app.get('/api/products', asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getProducts());
  }));

  app.post('/api/products', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    const prod = DatabaseEngine.createProduct(req.body);
    await DatabaseEngine.flush();
    broadcastEvent('menu-update', { type: 'product_created', product: prod });
    res.status(201).json(prod);
  }));

  app.put('/api/products/:id', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    const prod = DatabaseEngine.updateProduct(req.params.id, req.body);
    await DatabaseEngine.flush();
    broadcastEvent('menu-update', { type: 'product_updated', product: prod });
    res.json(prod);
  }));

  app.delete('/api/products/:id', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    DatabaseEngine.deleteProduct(req.params.id);
    await DatabaseEngine.flush();
    broadcastEvent('menu-update', { type: 'product_deleted', id: req.params.id });
    res.json({ success: true });
  }));

  // Orders API Routes
  app.get('/api/orders', asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getOrders());
  }));

  app.post('/api/orders', asyncHandler(async (req: Request, res: Response) => {
    const { tableId, items, notes, source, sessionId } = req.body;
    if (!tableId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'tableId and non-empty items array are required' });
    }
    const order = DatabaseEngine.createOrder(
      tableId,
      items,
      notes,
      source as OrderSource | undefined,
      typeof sessionId === 'string' ? sessionId : undefined
    );
    await DatabaseEngine.flush();
    broadcastEvent(order.status === OrderStatus.PENDING ? 'new-order-request' : 'new-order', order);
    broadcastEvent('order-update', order);
    
    // Broadcast status change for table
    const table = DatabaseEngine.getTable(tableId);
    if (table) {
      broadcastEvent('table-update', table);
    }
    
    res.status(201).json(order);
  }));

  app.post('/api/orders/:id/status', requireAuth(['ADMIN', 'WAITER', 'KITCHEN']), asyncHandler(async (req: Request, res: Response) => {
    const { status, prepTimeEstimate, startNewSession, kitchenItemIds } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });
    const session = readAuthSession(req);
    
    const order = DatabaseEngine.updateOrderStatus(
      req.params.id,
      status as OrderStatus,
      prepTimeEstimate,
      Boolean(startNewSession),
      Array.isArray(kitchenItemIds) ? kitchenItemIds.map((id) => String(id)) : undefined,
      session?.role
    );
    await DatabaseEngine.flush();
    if (order.status === OrderStatus.CONFIRMED) {
      broadcastEvent('new-order', order);
    }
    broadcastEvent('order-update', order);

    const table = DatabaseEngine.getTable(order.tableId);
    if (table) {
      broadcastEvent('table-update', table);
    }

    res.json(order);
  }));

  app.post('/api/orders/:id/items', requireAuth(['ADMIN', 'WAITER']), asyncHandler(async (req: Request, res: Response) => {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items trebuie sa fie o lista nevida' });
    }

    const order = DatabaseEngine.appendItemsToPendingOrder(req.params.id, items);
    await DatabaseEngine.flush();
    broadcastEvent('order-update', order);

    const table = DatabaseEngine.getTable(order.tableId);
    if (table) {
      broadcastEvent('table-update', table);
    }

    res.json(order);
  }));

  // Reviews API Routes
  app.get('/api/reviews', asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getReviews());
  }));

  app.post('/api/reviews', asyncHandler(async (req: Request, res: Response) => {
    const { orderId, rating, comment, productId, productName, customerName } = req.body;
    if (!orderId || !rating) return res.status(400).json({ error: 'orderId and rating are required' });
    const rev = DatabaseEngine.createReview(orderId, rating, comment, productId, productName, customerName);
    await DatabaseEngine.flush();
    broadcastEvent('new-review', rev);
    res.status(201).json(rev);
  }));

  // Bill API Routes
  app.get('/api/bills', asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getBills());
  }));

  app.post('/api/bills/request', asyncHandler(async (req: Request, res: Response) => {
    const { tableId, orderIds, paymentMethod } = req.body;
    if (!tableId || !orderIds || !paymentMethod) {
      return res.status(400).json({ error: 'tableId, orderIds and paymentMethod are required' });
    }
    const bill = DatabaseEngine.requestBill(tableId, orderIds, paymentMethod);
    await DatabaseEngine.flush();
    broadcastEvent('bill-update', bill);

    const table = DatabaseEngine.getTable(tableId);
    if (table) {
      broadcastEvent('table-update', table);
    }

    res.status(201).json(bill);
  }));

  app.post('/api/bills/:id/status', requireAuth(['ADMIN', 'WAITER']), asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });
    const bill = DatabaseEngine.updateBillStatus(req.params.id, status as BillStatus);
    await DatabaseEngine.flush();
    broadcastEvent('bill-update', bill);

    const table = DatabaseEngine.getTable(bill.tableId);
    if (table) {
      broadcastEvent('table-update', table);
    }

    res.json(bill);
  }));

  app.get('/api/waiter-requests', requireAuth(['ADMIN', 'WAITER']), asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getWaiterRequests());
  }));

  app.post('/api/waiter-requests', asyncHandler(async (req: Request, res: Response) => {
    const { tableId, items, notes } = req.body;
    if (!tableId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'tableId and items are required' });
    }

    const waiterRequest = DatabaseEngine.createWaiterRequest(tableId, items, notes);
    await DatabaseEngine.flush();
    broadcastEvent('new-waiter-request', waiterRequest);
    broadcastEvent('waiter-request-update', waiterRequest);
    res.status(201).json(waiterRequest);
  }));

  app.post('/api/waiter-requests/:id/resolve', requireAuth(['ADMIN', 'WAITER']), asyncHandler(async (req: Request, res: Response) => {
    const waiterRequest = DatabaseEngine.resolveWaiterRequest(req.params.id);
    await DatabaseEngine.flush();
    broadcastEvent('waiter-request-update', waiterRequest);
    res.json(waiterRequest);
  }));

  // Stats Analytics API Endpoint
  app.get('/api/stats', requireAuth(['ADMIN']), asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getStats());
  }));

  app.get('/api/settings', asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getSettings());
  }));

  app.put('/api/settings', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    const settings = DatabaseEngine.updateSettings(req.body || {});
    await DatabaseEngine.flush();
    broadcastEvent('settings-update', settings);
    res.json(settings);
  }));

  app.get('/api/access-control', requireAuth(['ADMIN']), asyncHandler((req: Request, res: Response) => {
    res.json(DatabaseEngine.getAccessControlSummary());
  }));

  app.put('/api/access-control', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    const accessControlSummary = DatabaseEngine.updateAccessControl(req.body || {});
    await DatabaseEngine.flush();
    res.json(accessControlSummary);
  }));

  app.post('/api/admin/reset-operational-data', requireAuth(['ADMIN']), asyncHandler(async (req: Request, res: Response) => {
    const result = DatabaseEngine.resetOperationalData();
    await DatabaseEngine.flush();
    DatabaseEngine.getTables().forEach((table) => {
      broadcastEvent('table-update', table);
    });
    broadcastEvent('database-reset', result);
    res.json(result);
  }));

  // Error handling middleware
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ error: err.message || 'Fatal internal server error' });
  });

  // Vite Server Integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Restaurant systems server active on: http://0.0.0.0:${PORT}`);
  });
}

startServer();
