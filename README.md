<<<<<<< HEAD
# Restaurant QR Ordering System

Full-stack restaurant ordering app with separate links for customer, waiter, kitchen and admin.

## What changed

- `/customer?table=3` is the customer menu link used in QR codes.
- `/waiter` is the waiter assistant.
- `/kitchen` is the kitchen board.
- `/admin` is the admin console.
- Customer orders now stay in `PENDING` until a waiter approves them.
- Only approved orders reach the kitchen.
- The kitchen board includes a recent history section for delivered and cancelled orders.
- QR generation now uses a real QR payload, not a decorative SVG.

## Stack

- React 19
- Vite
- Express
- TypeScript
- Server-Sent Events for live updates
- JSON persistence in `data_store.json`

## Run locally

```bash
npm install
npm run dev
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/customer?table=1`
- `http://localhost:3000/waiter`
- `http://localhost:3000/kitchen`
- `http://localhost:3000/admin`

## Main flow

1. Customer scans the QR code and sends an order request.
2. Waiter sees the request in the approval queue.
3. Waiter approves the order.
4. Kitchen receives the approved order and updates statuses.
5. Waiter delivers ready dishes and closes bills.

## Important files

- `server.ts`: API routes and SSE events
- `server_db.ts`: local persistence and business logic
- `src/App.tsx`: route-based entry point
- `src/components/CustomerApp.tsx`: customer menu and tracker
- `src/components/WaiterApp.tsx`: waiter approval and floor flow
- `src/components/KitchenApp.tsx`: kitchen board and history
- `src/components/AdminApp.tsx`: analytics, menu, QR generation
- `src/utils.ts`: currency helpers and real QR generation

## Notes

- `database_schema.sql` is still available as the Supabase/Postgres schema reference for a future database-backed version.
- Current runtime persistence remains file-based through `data_store.json`.
=======
A
>>>>>>> 187b7007d60c950776c6ebfd6095b7c4504ace4c
