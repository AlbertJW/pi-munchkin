import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "..", "data", "catalog.json"), "utf8"));

const state = {
  items: catalog.items.map((it) => ({ ...it })),
  taxRates: { ...catalog.taxRates },
  orders: [],
};

export function reset() {
  state.items = catalog.items.map((it) => ({ ...it }));
  state.orders = [];
}

export function items() { return state.items; }
export function taxRates() { return state.taxRates; }
export function findItem(sku) { return state.items.find((it) => it.sku === sku); }
export function orders() { return state.orders; }
export function pushOrder(order) { state.orders.push(order); }
