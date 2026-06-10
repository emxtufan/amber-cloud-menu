import React, { useEffect, useMemo, useState } from 'react';
import AdminApp from './components/AdminApp.js';
import CustomerApp from './components/CustomerApp.js';
import KitchenApp from './components/KitchenApp.js';
import WaiterApp from './components/WaiterApp.js';
import { api } from './services/api.js';
import { AuthSessionInfo, InternalRole, Table } from './types.js';

type AppRoute = 'home' | 'customer' | 'waiter' | 'kitchen' | 'admin';

function getRoute(): AppRoute {
  if (typeof window === 'undefined') {
    return 'home';
  }

  const path = window.location.pathname.toLowerCase();
  if (path.startsWith('/customer')) return 'customer';
  if (path.startsWith('/waiter')) return 'waiter';
  if (path.startsWith('/kitchen')) return 'kitchen';
  if (path.startsWith('/admin')) return 'admin';
  return 'home';
}

function getRequestedTableId(tables: Table[]) {
  if (typeof window === 'undefined' || tables.length === 0) {
    return '';
  }

  const params = new URLSearchParams(window.location.search);
  const queryTable = params.get('table');
  if (!queryTable) {
    return tables[0]?.id || '';
  }

  const match = tables.find(
    (table) => String(table.number) === queryTable || table.id === queryTable
  );

  return match?.id || tables[0]?.id || '';
}

export default function App() {
  const [tables, setTables] = useState<Table[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(true);
  const [authSession, setAuthSession] = useState<AuthSessionInfo>({ authenticated: false });
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [loginRole, setLoginRole] = useState<InternalRole>('ADMIN');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [rolePin, setRolePin] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const sortTables = (nextTables: Table[]) =>
      [...nextTables].sort((left, right) => left.number - right.number);

    const loadTables = async () => {
      try {
        const data = await api.getTables();
        if (isMounted) {
          setTables(sortTables(data));
        }
      } catch (error) {
        console.error('Nu am putut incarca mesele', error);
      } finally {
        if (isMounted) {
          setIsLoadingTables(false);
        }
      }
    };

    loadTables();

    const unsubTableUpdate = api.subscribe('table-update', (table: Table) => {
      if (!isMounted) {
        return;
      }

      setTables((current) => {
        const existingIndex = current.findIndex((entry) => entry.id === table.id);
        if (existingIndex === -1) {
          return sortTables([...current, table]);
        }

        const next = [...current];
        next[existingIndex] = table;
        return sortTables(next);
      });
      setIsLoadingTables(false);
    });

    const unsubTableDelete = api.subscribe('table-delete', ({ id }: { id: string }) => {
      if (!isMounted) {
        return;
      }

      setTables((current) => current.filter((table) => table.id !== id));
    });

    return () => {
      isMounted = false;
      unsubTableUpdate();
      unsubTableDelete();
    };
  }, []);

  const route = useMemo(() => getRoute(), []);
  const selectedTableId = useMemo(() => getRequestedTableId(tables), [tables]);
  const requiredInternalRole = route === 'admin' ? 'ADMIN' : route === 'waiter' ? 'WAITER' : route === 'kitchen' ? 'KITCHEN' : null;

  useEffect(() => {
    if (route === 'customer') {
      setIsLoadingAuth(false);
      return;
    }

    let isMounted = true;
    const loadSession = async () => {
      try {
        const session = await api.getAuthSession();
        if (isMounted) {
          setAuthSession(session);
        }
      } catch (error) {
        if (isMounted) {
          setAuthSession({ authenticated: false });
        }
      } finally {
        if (isMounted) {
          setIsLoadingAuth(false);
        }
      }
    };

    loadSession();
    return () => {
      isMounted = false;
    };
  }, [route]);

  useEffect(() => {
    if (route === 'customer' || !authSession.authenticated || !authSession.role) {
      return;
    }

    const timeoutByRole: Record<InternalRole, number> = {
      ADMIN: 15 * 60 * 1000,
      WAITER: 5 * 60 * 1000,
      KITCHEN: 10 * 60 * 1000,
    };

    const timeoutMs = timeoutByRole[authSession.role];
    let timeoutId = window.setTimeout(() => {
      void api.logout().finally(() => {
        setAuthSession({ authenticated: false });
        setAuthError('Sesiunea a expirat dupa inactivitate. Autentifica-te din nou.');
      });
    }, timeoutMs);

    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void api.logout().finally(() => {
          setAuthSession({ authenticated: false });
          setAuthError('Sesiunea a expirat dupa inactivitate. Autentifica-te din nou.');
        });
      }, timeoutMs);
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'scroll'];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));

    return () => {
      window.clearTimeout(timeoutId);
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [authSession, route]);

  const destinationByRole: Record<InternalRole, string> = {
    ADMIN: '/admin',
    WAITER: '/waiter',
    KITCHEN: '/kitchen',
  };

  const performLogout = async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Nu am putut inchide sesiunea', error);
    } finally {
      setAuthSession({ authenticated: false });
      setAdminPassword('');
      setRolePin('');
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.location.assign('/');
      }
    }
  };

  const submitInternalLogin = async () => {
    setIsSubmittingAuth(true);
    setAuthError('');

    try {
      const roleToUse = route === 'home' ? loginRole : requiredInternalRole;
      if (!roleToUse) {
        return;
      }

      const session =
        roleToUse === 'ADMIN'
          ? await api.login('ADMIN', { username: adminUsername.trim(), password: adminPassword })
          : await api.login(roleToUse, { pin: rolePin });

      setAuthSession(session);
      setAdminPassword('');
      setRolePin('');
      const destination = destinationByRole[roleToUse];
      if (window.location.pathname.toLowerCase() !== destination.toLowerCase()) {
        window.location.assign(destination);
      }
    } catch (error) {
      console.error('Nu am putut autentifica sesiunea interna', error);
      setAuthError(error instanceof Error ? error.message : 'Autentificare esuata.');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const renderInternalLogin = (role: InternalRole | null, allowRoleSwitch = false) => {
    const activeRole = allowRoleSwitch ? loginRole : role || 'ADMIN';

    return (
      <div className="min-h-screen bg-background text-white px-4 py-6">
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
          <div className="grid w-full gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[32px] border border-white/8 bg-card p-6">
              <p className="text-xs font-mono uppercase tracking-[0.34em] text-primary">Acces intern</p>
              <h1 className="mt-4 text-3xl font-display font-bold text-white">Panourile restaurantului nu mai sunt publice</h1>
              <p className="mt-4 text-sm leading-7 text-muted">
                Adminul foloseste username si parola, iar ospatarul si bucataria au PIN-uri separate stocate doar pe server.
              </p>

              {authSession.authenticated && authSession.role ? (
                <div className="mt-6 rounded-[24px] border border-success/20 bg-success/10 p-4">
                  <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-success">Sesiune activa</p>
                  <p className="mt-2 text-lg font-display font-bold text-white">
                    {authSession.role === 'ADMIN' ? 'Admin' : authSession.role === 'WAITER' ? 'Ospatar' : 'Bucatarie'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => window.location.assign(destinationByRole[authSession.role as InternalRole])}
                      className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white"
                    >
                      Deschide panoul
                    </button>
                    <button
                      onClick={() => void performLogout()}
                      className="rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm font-semibold text-white"
                    >
                      Iesi
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-[24px] border border-white/8 bg-background/70 p-4 text-sm text-muted">
                  Meniul client ramane separat pe linkurile QR ale meselor. Aici sunt doar intrarile pentru echipa.
                </div>
              )}
            </div>

            <div className="rounded-[32px] border border-white/8 bg-card p-6">
              {allowRoleSwitch && (
                <div className="mb-5 flex flex-wrap gap-2">
                  {(['ADMIN', 'WAITER', 'KITCHEN'] as InternalRole[]).map((entry) => (
                    <button
                      key={entry}
                      onClick={() => {
                        setLoginRole(entry);
                        setAuthError('');
                      }}
                      className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                        activeRole === entry ? 'bg-primary text-white' : 'border border-white/8 bg-background text-muted'
                      }`}
                    >
                      {entry === 'ADMIN' ? 'Admin' : entry === 'WAITER' ? 'Ospatar' : 'Bucatarie'}
                    </button>
                  ))}
                </div>
              )}

              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-primary">
                {activeRole === 'ADMIN' ? 'Login admin' : activeRole === 'WAITER' ? 'PIN ospatar' : 'PIN bucatarie'}
              </p>
              <h2 className="mt-3 text-2xl font-display font-bold text-white">
                {activeRole === 'ADMIN' ? 'Autentificare admin' : activeRole === 'WAITER' ? 'Deblocare panou ospatar' : 'Deblocare panou bucatarie'}
              </h2>

              <div className="mt-5 space-y-3">
                {activeRole === 'ADMIN' ? (
                  <>
                    <input
                      type="text"
                      value={adminUsername}
                      onChange={(event) => setAdminUsername(event.target.value)}
                      placeholder="Username admin"
                      className="w-full rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm text-white outline-none"
                    />
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(event) => setAdminPassword(event.target.value)}
                      placeholder="Parola admin"
                      className="w-full rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm text-white outline-none"
                    />
                  </>
                ) : (
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={rolePin}
                    onChange={(event) => setRolePin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="Introdu PIN-ul"
                    className="w-full rounded-2xl border border-white/8 bg-background px-4 py-3 text-sm text-white outline-none"
                  />
                )}

                {authError ? (
                  <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
                    {authError}
                  </div>
                ) : null}

                <button
                  onClick={() => void submitInternalLogin()}
                  disabled={isSubmittingAuth}
                  className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmittingAuth ? 'Se verifica...' : 'Autentifica-te'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (route === 'customer' && isLoadingTables) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-sm font-mono text-muted uppercase tracking-[0.3em]">Se incarca sesiunea mesei</p>
          <h1 className="text-2xl font-display font-bold mt-3">Pregatim meniul tau...</h1>
        </div>
      </div>
    );
  }

  if (route !== 'customer' && isLoadingAuth) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-sm font-mono text-muted uppercase tracking-[0.3em]">Verificare acces intern</p>
          <h1 className="text-2xl font-display font-bold mt-3">Pregatim sesiunea securizata...</h1>
        </div>
      </div>
    );
  }

  if (route === 'home') {
    return renderInternalLogin(null, true);
  }

  if (requiredInternalRole && (!authSession.authenticated || authSession.role !== requiredInternalRole)) {
    return renderInternalLogin(requiredInternalRole, false);
  }

  return (
    <div className="min-h-screen bg-background text-white">
      {route === 'customer' && <CustomerApp tableId={selectedTableId} tables={tables} />}
      {route === 'waiter' && <WaiterApp onLogout={() => void performLogout()} />}
      {route === 'kitchen' && <KitchenApp onLogout={() => void performLogout()} />}
      {route === 'admin' && <AdminApp onLogout={() => void performLogout()} />}
    </div>
  );
}
