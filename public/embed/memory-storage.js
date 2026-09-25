// The Spec viewer's frame (/embed/specs/…) is sandboxed without
// allow-same-origin, so it has an opaque origin and reading localStorage or
// sessionStorage throws. Scalar reads them as it starts; this gives the frame
// storage that lives in memory, for this page only, before Scalar loads.
(() => {
  class MemoryStorage {
    #items = new Map();
    get length() {
      return this.#items.size;
    }
    key(index) {
      return [...this.#items.keys()][index] ?? null;
    }
    getItem(key) {
      return this.#items.has(String(key)) ? this.#items.get(String(key)) : null;
    }
    setItem(key, value) {
      this.#items.set(String(key), String(value));
    }
    removeItem(key) {
      this.#items.delete(String(key));
    }
    clear() {
      this.#items.clear();
    }
  }
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      window[name];
    } catch {
      Object.defineProperty(window, name, {
        value: new MemoryStorage(),
        configurable: true,
      });
    }
  }
})();
