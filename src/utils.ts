import qrcode from 'qrcode-generator';
import { OrderSource, OrderStatus, Table, TableStatus } from './types.js';

export function formatCad(amount: number): string {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: 'RON',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatTimeElapsed(createdAtString: string): string {
  const created = new Date(createdAtString).getTime();
  const diff = Date.now() - created;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Chiar acum';
  if (mins < 60) return `${mins} min in urma`;

  const hours = Math.floor(mins / 60);
  const remainingMinutes = mins % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes} min in urma` : `${hours}h in urma`;
}

export function formatDateTime(dateTimeStr: string): string {
  const date = new Date(dateTimeStr);
  return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

export function getOrderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.PENDING:
      return 'In asteptare';
    case OrderStatus.CONFIRMED:
      return 'Confirmata';
    case OrderStatus.PREPARING:
      return 'In pregatire';
    case OrderStatus.READY:
      return 'Gata';
    case OrderStatus.DELIVERED:
      return 'Livrata';
    case OrderStatus.CANCELLED:
      return 'Anulata';
    default:
      return status;
  }
}

export function getOrderSourceLabel(source: OrderSource): string {
  switch (source) {
    case OrderSource.CUSTOMER:
      return 'Client';
    case OrderSource.WAITER:
      return 'Ospatar';
    default:
      return source;
  }
}

export function getTableStatusLabel(status: TableStatus): string {
  switch (status) {
    case TableStatus.AVAILABLE:
      return 'Disponibila';
    case TableStatus.WAITING:
      return 'In asteptare';
    case TableStatus.PREPARING:
      return 'In pregatire';
    case TableStatus.READY:
      return 'Gata';
    case TableStatus.NEEDS_BILL:
      return 'Nota ceruta';
    default:
      return status;
  }
}

export function getTableAreaLabel(area?: string): string {
  if (area === 'TERASA') {
    return 'Terasa';
  }

  if (area === 'INTERIOR') {
    return 'Interior';
  }

  return area || 'Interior';
}

export function getTableDisplayLabel(table: Pick<Table, 'number' | 'name' | 'area'>): string {
  const areaLabel = getTableAreaLabel(table.area).toLowerCase();

  if (table.name) {
    const trimmedName = table.name.trim();
    const terraceMatch = trimmedName.match(/^Terasa\s+(\d+)$/i);
    if (terraceMatch) {
      return `Masa ${terraceMatch[1]} terasa`;
    }

    const interiorMatch = trimmedName.match(/^Interior\s+(\d+)$/i);
    if (interiorMatch) {
      return `Masa ${interiorMatch[1]} interior`;
    }

    if (/^Masa\s+/i.test(trimmedName)) {
      return trimmedName;
    }
  }

  return `Masa ${table.number} ${areaLabel}`;
}

export function getTableQrLabel(table: Pick<Table, 'number' | 'name' | 'area'>): string {
  if (table.name) {
    const trimmedName = table.name.trim();
    const terraceMatch = trimmedName.match(/^Terasa\s+(\d+)$/i);
    if (terraceMatch) {
      return `T${terraceMatch[1]}`;
    }

    const interiorMatch = trimmedName.match(/^Interior\s+(\d+)$/i);
    if (interiorMatch) {
      return `I${interiorMatch[1]}`;
    }
  }

  if (table.area === 'TERASA') {
    return `T${table.number}`;
  }

  return `I${table.number}`;
}

export function getPaymentMethodLabel(paymentMethod?: 'CASH' | 'CARD' | 'PROTOCOL'): string {
  if (paymentMethod === 'CARD') {
    return 'Card';
  }

  if (paymentMethod === 'CASH') {
    return 'Cash';
  }

  if (paymentMethod === 'PROTOCOL') {
    return 'Protocol';
  }

  return '-';
}

export function generateQrSvg(tableNumber: number, baseUrl: string, centerLabel?: string): { svgMarkup: string; targetUrl: string } {
  const targetUrl = `${baseUrl}/customer?table=${tableNumber}`;
  const qr = qrcode(0, 'H');
  qr.addData(targetUrl);
  qr.make();

  const rawSvg = qr.createSvgTag({
    cellSize: 8,
    margin: 2,
    scalable: true,
  });

  const viewBoxMatch = rawSvg.match(/viewBox="([\d.\s-]+)"/);
  const [, rawViewBox = '0 0 236 236'] = viewBoxMatch || [];
  const viewBoxParts = rawViewBox.split(/\s+/).map(Number);
  const qrWidth = viewBoxParts[2] || 236;
  const qrHeight = viewBoxParts[3] || 236;
  const centerX = qrWidth / 2;
  const centerY = qrHeight / 2;
  const badgeRadius = Math.min(qrWidth, qrHeight) * 0.145;
  const badgeStrokeWidth = Math.max(3, badgeRadius * 0.12);
  const tableLabel = centerLabel?.trim() || String(tableNumber);
  const fontSize = tableLabel.length >= 3 ? badgeRadius * 0.75 : badgeRadius * 0.95;
  const centerBadgeMarkup = `
    <g aria-label="Numar masa">
      <circle cx="${centerX}" cy="${centerY}" r="${badgeRadius}" fill="#ffffff" stroke="#0B0D12" stroke-width="${badgeStrokeWidth}" />
      <text
        x="${centerX}"
        y="${centerY}"
        text-anchor="middle"
        dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
        fill="#0B0D12"
      >${tableLabel}</text>
    </g>
  `;

  const svgMarkup = rawSvg
    .replace('<svg', '<svg class="w-full h-full"')
    .replace(/<rect([^>]*)fill="white"/g, '<rect$1fill="#ffffff"')
    .replace(/fill="black"/g, 'fill="#0B0D12"')
    .replace('</svg>', `${centerBadgeMarkup}</svg>`);

  return { svgMarkup, targetUrl };
}
