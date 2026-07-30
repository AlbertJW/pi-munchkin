import { listOrders } from "./orders.js";
import { subtotal } from "./pricing.js";
import { taxForLines } from "./tax.js";
import { dayKey } from "./util/dates.js";
import { TAX_RATE } from "./config.js";

// Revenue per day (docs/audit-notes.md, Reports + Pricing).
export function dailyRevenue() {
  const days = new Map();
  for (const order of listOrders()) {
    const key = dayKey(order.placedAt);
    const sub = subtotal(order.lines);
    const revenue = sub + Math.round(sub * TAX_RATE);
    days.set(key, (days.get(key) ?? 0) + revenue);
  }
  return days;
}

export function grandTotal(lines) {
  return subtotal(lines) + taxForLines(lines);
}
