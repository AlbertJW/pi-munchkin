import { settings } from './config.js';

const RATE = 1.25;

export function lineTotal(item) {
  let total = item.qty * item.price * RATE;
  total = total + settings.handlingFee;
  if (item.discounted) total = total * (1 - settings.discountRate);
  return Math.round(total * 100) / 100;
}

export function formatQty(item) {
  return String(item.qty).padStart(5, ' ');
}

export function formatMoney(value) {
  return value.toFixed(2);
}

export function buildReport(items) {
  const rows = items.map((i) => `${i.name} ${formatQty(i)} ${formatMoney(lineTotal(i))}`);
  const total = items.reduce((sum, i) => sum + lineTotal(i), 0);
  return rows.join('\n') + '\nTOTAL ' + formatMoney(Math.round(total * 100) / 100);
}
