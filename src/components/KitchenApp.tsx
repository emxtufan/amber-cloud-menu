import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, ChefHat, CheckCircle2, Clock3, Flame, History, XCircle } from 'lucide-react';
import { api } from '../services/api.js';
import { Order, OrderStatus } from '../types.js';
import { formatTimeElapsed, getOrderSourceLabel, getOrderStatusLabel } from '../utils.js';

function getKitchenItems(order: Order) {
  return order.items.filter((item) => item.sendToKitchen !== false);
}

function hasKitchenItems(order: Order) {
  return getKitchenItems(order).length > 0;
}

function playKitchenNotificationSound() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(990, audioContext.currentTime + 0.15);

    gainNode.gain.setValueAtTime(0.18, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.45);
  } catch (error) {
    console.log('Contextul audio nu este pregatit inca.', error);
  }
}

export default function KitchenApp() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedOrderView, setSelectedOrderView] = useState<'prep' | 'history'>('prep');
  const [prepTimeInput, setPrepTimeInput] = useState(15);
  const [, setTimerTick] = useState(0);

  const fetchOrders = async () => {
    try {
      const data = await api.getOrders();
      setOrders(data);
    } catch (error) {
      console.error('Nu am putut incarca comenzile din bucatarie', error);
    }
  };

  useEffect(() => {
    fetchOrders();

    const timer = setInterval(() => {
      setTimerTick((value) => value + 1);
    }, 15000);

    const refreshOrder = (incomingOrder: Order) => {
      setOrders((currentOrders) => {
        const existingIndex = currentOrders.findIndex((order) => order.id === incomingOrder.id);
        if (existingIndex === -1) {
          return [incomingOrder, ...currentOrders];
        }

        const nextOrders = [...currentOrders];
        nextOrders[existingIndex] = incomingOrder;
        return nextOrders;
      });
    };

    const unsubNewOrder = api.subscribe('new-order', (incomingOrder: Order) => {
      if (incomingOrder.status !== OrderStatus.CONFIRMED || !hasKitchenItems(incomingOrder)) {
        return;
      }

      refreshOrder(incomingOrder);
      playKitchenNotificationSound();
      setAlertMessage(`Comanda aprobata noua ${incomingOrder.orderNumber} de la masa ${incomingOrder.tableNumber}`);
      setTimeout(() => setAlertMessage(null), 4500);
    });

    const unsubOrderUpdate = api.subscribe('order-update', refreshOrder);

    return () => {
      clearInterval(timer);
      unsubNewOrder();
      unsubOrderUpdate();
    };
  }, []);

  const incomingOrders = useMemo(
    () => orders.filter((order) => order.status === OrderStatus.CONFIRMED && hasKitchenItems(order)),
    [orders]
  );
  const preparingOrders = useMemo(
    () => orders.filter((order) => order.status === OrderStatus.PREPARING && hasKitchenItems(order)),
    [orders]
  );
  const readyOrders = useMemo(
    () => orders.filter((order) => order.status === OrderStatus.READY && hasKitchenItems(order)),
    [orders]
  );
  const historyOrders = useMemo(
    () =>
      orders
        .filter((order) => [OrderStatus.DELIVERED, OrderStatus.CANCELLED].includes(order.status) && hasKitchenItems(order))
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .slice(0, 12),
    [orders]
  );

  const updateStatus = async (orderId: string, status: OrderStatus, prepTimeEstimate?: number) => {
    try {
      await api.updateOrderStatus(orderId, status, prepTimeEstimate);
      fetchOrders();
      setSelectedOrder(null);
    } catch (error) {
      console.error('Nu am putut actualiza statusul din bucatarie', error);
    }
  };

  const renderOrderCard = (
    order: Order,
    accent: string,
    actionLabel: string,
    action: () => void,
    secondaryAction?: { label: string; run: () => void; danger?: boolean }
  ) => (
    <div key={order.id} className={`rounded-[24px] border p-4 bg-card/80 ${accent}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.25em] text-muted">Masa {order.tableNumber}</p>
          <h3 className="mt-2 text-lg font-display font-bold">{order.orderNumber}</h3>
          <p className="mt-1 text-xs text-muted">{formatTimeElapsed(order.createdAt)}</p>
        </div>
        <span className="text-[11px] font-mono uppercase text-primary">{getOrderSourceLabel(order.source)}</span>
      </div>

      <div className="mt-4 space-y-2">
        {getKitchenItems(order).map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold">{item.productName}</p>
              {item.notes && <p className="text-xs text-primary mt-1">{item.notes}</p>}
            </div>
            <span className="text-muted font-mono">x{item.quantity}</span>
          </div>
        ))}
      </div>

      {order.notes && (
        <div className="mt-4 rounded-2xl border border-white/8 bg-background/60 px-3 py-3 text-xs text-muted">
          {order.notes}
        </div>
      )}

      {order.prepTimeEstimate && order.status === OrderStatus.PREPARING && (
        <div className="mt-4 rounded-2xl border border-warning/20 bg-warning/10 px-3 py-3 text-xs text-warning">
          Timp tinta de pregatire: {order.prepTimeEstimate} minute
        </div>
      )}

      <div className={`mt-4 grid gap-2 ${secondaryAction ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {secondaryAction && (
          <button
            onClick={secondaryAction.run}
            className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
              secondaryAction.danger
                ? 'border border-danger/20 bg-danger/10 text-danger'
                : 'border border-white/8 bg-background text-white'
            }`}
          >
            {secondaryAction.label}
          </button>
        )}
        <button onClick={action} className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold">
          {actionLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-white px-4 py-5 md:px-6">
      <div className="max-w-7xl mx-auto flex flex-col gap-6">
        {alertMessage && (
          <div className="rounded-[24px] border border-primary/30 bg-primary/15 px-5 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BellRing className="w-5 h-5 text-primary" />
              <span className="text-sm font-semibold">{alertMessage}</span>
            </div>
            <button onClick={() => setAlertMessage(null)} className="text-xs font-mono uppercase text-muted">
              inchide
            </button>
          </div>
        )}

        <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-card border border-white/8 flex items-center justify-center">
              <ChefHat className="w-6 h-6 text-warning" />
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.35em] text-warning">Panou bucatarie</p>
              <h1 className="mt-2 text-3xl font-display font-bold">Doar comenzile aprobate ajung in bucatarie</h1>
            </div>
          </div>

          <button
            onClick={playKitchenNotificationSound}
            className="rounded-2xl border border-white/8 bg-card px-4 py-3 text-sm text-muted"
          >
            Test sunet bucatarie
          </button>
        </header>

        <main className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <section className="rounded-[28px] border border-white/8 bg-card p-5">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Clock3 className="w-4 h-4 text-primary" />
                <h2 className="text-lg font-display font-bold">Comenzi aprobate noi</h2>
              </div>
              <span className="text-xs font-mono uppercase text-muted">{incomingOrders.length}</span>
            </div>

            <div className="mt-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {incomingOrders.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted">Nu exista comenzi aprobate in asteptare.</div>
              ) : (
                incomingOrders.map((order) =>
                  renderOrderCard(
                    order,
                    'border-primary/20',
                    'Porneste gatirea',
                    () => {
                      setSelectedOrderView('prep');
                      setSelectedOrder(order);
                      setPrepTimeInput(order.prepTimeEstimate || 15);
                    },
                    {
                      label: 'Anuleaza',
                      run: () => updateStatus(order.id, OrderStatus.CANCELLED),
                      danger: true,
                    }
                  )
                )
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/8 bg-card p-5">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-warning" />
                <h2 className="text-lg font-display font-bold">In pregatire</h2>
              </div>
              <span className="text-xs font-mono uppercase text-muted">{preparingOrders.length}</span>
            </div>

            <div className="mt-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {preparingOrders.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted">Nu se gateste nimic acum.</div>
              ) : (
                preparingOrders.map((order) =>
                  renderOrderCard(order, 'border-warning/20', 'Marcheaza gata', () =>
                    updateStatus(order.id, OrderStatus.READY)
                  )
                )
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/8 bg-card p-5">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success" />
                <h2 className="text-lg font-display font-bold">Gata pentru ridicare de catre ospatar</h2>
              </div>
              <span className="text-xs font-mono uppercase text-muted">{readyOrders.length}</span>
            </div>

            <div className="mt-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {readyOrders.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted">Nu exista preparate care asteapta ridicarea.</div>
              ) : (
                readyOrders.map((order) =>
                  renderOrderCard(order, 'border-success/20', 'Marcheaza livrata', () =>
                    updateStatus(order.id, OrderStatus.DELIVERED)
                  )
                )
              )}
            </div>
          </section>
        </main>

        <section className="rounded-[28px] border border-white/8 bg-card p-5">
          <div className="flex items-center gap-2 border-b border-white/5 pb-3">
            <History className="w-4 h-4 text-muted" />
            <h2 className="text-lg font-display font-bold">Istoric bucatarie</h2>
          </div>

          {historyOrders.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">Nu exista inca istoric finalizat in bucatarie.</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {historyOrders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => {
                    setSelectedOrderView('history');
                    setSelectedOrder(order);
                  }}
                  className="rounded-[24px] border border-white/8 bg-background/60 p-4 text-left transition hover:border-primary/30 hover:bg-card/80"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono uppercase tracking-[0.25em] text-muted">Masa {order.tableNumber}</p>
                      <h3 className="mt-2 text-lg font-display font-bold">{order.orderNumber}</h3>
                      <p className="mt-2 text-xs text-white/70">
                        {getKitchenItems(order).reduce((sum, item) => sum + item.quantity, 0)} produse • {getOrderSourceLabel(order.source)}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-mono uppercase ${
                        order.status === OrderStatus.DELIVERED ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {getOrderStatusLabel(order.status)}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Actualizata {new Date(order.updatedAt).toLocaleString()}
                  </p>
                  <p className="mt-2 text-[11px] font-mono uppercase tracking-[0.18em] text-primary">
                    Apasa pentru detalii
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.25em] text-primary">
                  {selectedOrderView === 'prep' ? 'Porneste comanda' : 'Detalii istoric'}
                </p>
                <h3 className="mt-2 text-xl font-display font-bold">{selectedOrder.orderNumber}</h3>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="w-9 h-9 rounded-full bg-background border border-white/8 flex items-center justify-center"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            {selectedOrderView === 'prep' ? (
              <>
                <div className="mt-4 rounded-2xl border border-white/8 bg-background/60 p-4">
                  <p className="text-sm font-semibold">Seteaza estimarea de pregatire</p>
                  <div className="mt-3 rounded-[20px] border border-primary/20 bg-primary/10 px-4 py-4 text-center">
                    <p className="text-[11px] font-mono uppercase tracking-[0.25em] text-primary">Timp selectat</p>
                    <p className="mt-2 text-3xl font-display font-bold text-white">{prepTimeInput} min</p>
                    <p className="mt-2 text-xs text-white/70">
                      Aceasta estimare va fi vazuta de client si de ospatar pe comanda activa.
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {[5, 10, 15, 20, 25].map((value) => (
                      <button
                        key={value}
                        onClick={() => setPrepTimeInput(value)}
                        className={`rounded-2xl px-3 py-2 text-sm font-semibold ${
                          prepTimeInput === value ? 'bg-primary text-white' : 'bg-card border border-white/8 text-muted'
                        }`}
                      >
                        {value}m
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={45}
                    value={prepTimeInput}
                    onChange={(event) => setPrepTimeInput(Number(event.target.value))}
                    className="w-full mt-4 accent-primary"
                  />
                  <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-muted">
                    <span>3 min</span>
                    <span className="text-primary">{prepTimeInput} min selectat</span>
                    <span>45 min</span>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setSelectedOrder(null)}
                    className="flex-1 rounded-2xl border border-white/8 px-4 py-3 text-sm text-muted"
                  >
                    Inchide
                  </button>
                  <button
                    onClick={() => updateStatus(selectedOrder.id, OrderStatus.PREPARING, prepTimeInput)}
                    className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold"
                  >
                    Porneste gatirea - {prepTimeInput} min
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 rounded-2xl border border-white/8 bg-background/60 p-4">
                  <div className="grid grid-cols-2 gap-3 text-xs text-muted">
                    <div>
                      <p className="font-mono uppercase text-primary">Masa</p>
                      <p className="mt-2 text-sm font-semibold text-white">{selectedOrder.tableNumber}</p>
                    </div>
                    <div>
                      <p className="font-mono uppercase text-primary">Status</p>
                      <p className="mt-2 text-sm font-semibold text-white">{getOrderStatusLabel(selectedOrder.status)}</p>
                    </div>
                    <div>
                      <p className="font-mono uppercase text-primary">Sursa</p>
                      <p className="mt-2 text-sm font-semibold text-white">{getOrderSourceLabel(selectedOrder.source)}</p>
                    </div>
                    <div>
                      <p className="font-mono uppercase text-primary">Actualizata</p>
                      <p className="mt-2 text-sm font-semibold text-white">{new Date(selectedOrder.updatedAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/8 bg-background/60 p-4">
                  <p className="text-sm font-semibold">Produse trimise in bucatarie</p>
                  <div className="mt-3 space-y-2">
                    {getKitchenItems(selectedOrder).map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-white/8 bg-card/60 px-3 py-3 text-sm">
                        <div className="min-w-0">
                          <p className="font-semibold text-white">{item.productName}</p>
                          {item.notes && <p className="mt-1 text-xs text-primary">{item.notes}</p>}
                        </div>
                        <span className="shrink-0 font-mono text-muted">x{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedOrder.notes && (
                  <div className="mt-4 rounded-2xl border border-white/8 bg-background/60 px-4 py-3 text-xs text-muted">
                    {selectedOrder.notes}
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setSelectedOrder(null)}
                    className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold"
                  >
                    Inchide
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
