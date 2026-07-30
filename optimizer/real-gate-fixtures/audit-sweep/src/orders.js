import { findItem, orders, pushOrder } from "./db.js";
import { validateLine } from "./validate.js";

let nextId = 1;

export function placeOrder(lines, placedAt = new Date()) {
  for (const line of lines) {
    const v = validateLine(line);
    if (!v.ok) throw new Error(`invalid line: ${v.reason}`);
    const item = findItem(line.sku);
    if (!item) throw new Error(`unknown sku: ${line.sku}`);
    if (item.stock < line.qty) throw new Error(`insufficient stock: ${line.sku}`);
  }
  for (const line of lines) {
    findItem(line.sku).stock -= line.qty;
  }
  const order = { id: nextId++, lines: lines.map((l) => ({ ...l })), placedAt };
  pushOrder(order);
  return order;
}

export function listOrders() { return orders(); }

// Largest orders first, for the dashboard.
export function topOrders(n) {
  const all = orders();
  all.sort((a, b) => lineCount(b) - lineCount(a));
  return all.slice(0, n);
}

function lineCount(order) {
  return order.lines.reduce((s, l) => s + l.qty, 0);
}

export function _resetIds() { nextId = 1; }
