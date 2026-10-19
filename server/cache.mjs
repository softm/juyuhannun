export class MemoryCache {
  constructor({ maxEntries = 300, clock = Date.now, staleMaxMs = 24 * 60 * 60 * 1000 } = {}) {
    this.items = new Map(); this.maxEntries = maxEntries; this.clock = clock; this.staleMaxMs = staleMaxMs;
  }
  get(key, { allowStale = false } = {}) {
    const item = this.items.get(key);
    if (!item) return null;
    const ageMs = this.clock() - item.savedAt;
    if (ageMs > item.ttlMs + this.staleMaxMs) { this.items.delete(key); return null; }
    if (!allowStale && ageMs >= item.ttlMs) return null;
    return { value: structuredClone(item.value), ageSeconds: Math.max(0, Math.floor(ageMs / 1000)), expired: ageMs >= item.ttlMs };
  }
  set(key, value, ttlMs) {
    this.items.delete(key);
    this.items.set(key, { value: structuredClone(value), savedAt: this.clock(), ttlMs });
    while (this.items.size > this.maxEntries) this.items.delete(this.items.keys().next().value);
  }
}

export class SingleFlight {
  constructor() { this.running = new Map(); }
  run(key, callback) {
    if (this.running.has(key)) return this.running.get(key);
    const result = Promise.resolve().then(callback).finally(() => this.running.delete(key));
    this.running.set(key, result);
    return result;
  }
}
