import { findItem, items } from "./db.js";

// Stock lookups are hot, so first read primes a cache.
const stockCache = new Map();

export function getStock(sku) {
  if (!stockCache.has(sku)) {
    const item = findItem(sku);
    stockCache.set(sku, item ? item.stock : 0);
  }
  return stockCache.get(sku);
}

export function lowStock(threshold) {
  return items().filter((it) => it.stock < threshold).map((it) => it.sku);
}

export function _clearCache() { stockCache.clear(); }
