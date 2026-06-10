import React, { useEffect, useMemo, useState } from 'react';
import AdminApp from './components/AdminApp.js';
import CustomerApp from './components/CustomerApp.js';
import HomeApp from './components/HomeApp.js';
import KitchenApp from './components/KitchenApp.js';
import WaiterApp from './components/WaiterApp.js';
import { api } from './services/api.js';
import { Table } from './types.js';

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

  return (
    <div className="min-h-screen bg-background text-white">
      {route === 'customer' && <CustomerApp tableId={selectedTableId} tables={tables} />}
      {route === 'waiter' && <WaiterApp />}
      {route === 'kitchen' && <KitchenApp />}
      {route === 'admin' && <AdminApp />}
      {route === 'home' && <HomeApp tables={tables} />}
    </div>
  );
}
