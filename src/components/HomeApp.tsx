import React from 'react';
import { ChefHat, ClipboardList, QrCode, ShieldCheck } from 'lucide-react';
import { Table } from '../types.js';
import { getTableAreaLabel, getTableStatusLabel } from '../utils.js';

interface HomeAppProps {
  tables: Table[];
}

const roleCards = [
  {
    title: 'Meniu client',
    description: 'Deschide linkul de meniu care merge pe codul QR al fiecarei mese.',
    href: '/meniu',
    icon: QrCode,
    accent: 'text-primary border-primary/30 bg-primary/10',
  },
  {
    title: 'Asistent ospatar',
    description: 'Aproba cereri de la clienti, monitorizeaza mesele si inchide notele.',
    href: '/waiter',
    icon: ClipboardList,
    accent: 'text-success border-success/30 bg-success/10',
  },
  {
    title: 'Panou bucatarie',
    description: 'Aici ajung doar comenzile aprobate. Bucataria actualizeaza statusurile in timp real si vede istoricul.',
    href: '/kitchen',
    icon: ChefHat,
    accent: 'text-warning border-warning/30 bg-warning/10',
  },
  {
    title: 'Consola admin',
    description: 'Administreaza produsele, analizele si linkurile QR pentru tiparire.',
    href: '/admin',
    icon: ShieldCheck,
    accent: 'text-white border-white/15 bg-white/5',
  },
];

export default function HomeApp({ tables }: HomeAppProps) {
  return (
    <div className="min-h-screen bg-background text-white px-5 py-8 md:px-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-8">
        <header className="rounded-[32px] border border-white/10 bg-card/80 p-8 shadow-2xl">
          <p className="text-xs font-mono uppercase tracking-[0.35em] text-primary">Sistem QR pentru comenzi in restaurant</p>
          <h1 className="mt-4 text-4xl md:text-5xl font-display font-bold tracking-tight">
            Linkuri separate pentru client, ospatar si bucatarie.
          </h1>
          <p className="mt-4 max-w-3xl text-sm md:text-base text-muted leading-7">
            Comenzile clientilor asteapta acum aprobarea ospatarului inainte sa intre in coada bucatariei. Panoul de
            bucatarie primeste doar comenzile aprobate si pastreaza un istoric vizibil al finalizarii.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {roleCards.map((card) => {
            const Icon = card.icon;
            return (
              <a
                key={card.href}
                href={card.href}
                className="rounded-[28px] border border-white/8 bg-card p-5 flex flex-col gap-4 hover:border-white/20 hover:-translate-y-1 transition-all"
              >
                <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center ${card.accent}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-display font-bold">{card.title}</h2>
                  <p className="mt-2 text-sm text-muted leading-6">{card.description}</p>
                </div>
                <span className="text-xs font-mono uppercase tracking-[0.25em] text-primary">Deschide {card.href}</span>
              </a>
            );
          })}
        </section>

        <section className="rounded-[32px] border border-white/10 bg-card p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.35em] text-muted">Linkuri rapide pentru clienti</p>
              <h2 className="mt-2 text-2xl font-display font-bold">URL-uri directe pentru mese</h2>
            </div>
            <p className="text-sm text-muted">
              Acestea sunt aceleasi linkuri pe care generatorul QR din admin le va codifica pentru fiecare masa.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tables.map((table) => (
              <a
                key={table.id}
                href={`/meniu?table=${table.number}`}
                className="rounded-2xl border border-white/8 bg-background/50 px-4 py-4 flex items-center justify-between hover:border-primary/40 transition-all"
              >
                <div>
                  <p className="text-xs font-mono uppercase tracking-[0.25em] text-muted">Masa {table.number}</p>
                  <p className="mt-1 text-[11px] font-mono text-primary uppercase">{getTableAreaLabel(table.area)}</p>
                  <p className="mt-1 text-sm text-white">{`/meniu?table=${table.number}`}</p>
                </div>
                <span className="text-xs font-mono text-primary uppercase">{getTableStatusLabel(table.status)}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
