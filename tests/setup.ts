// Vitest setup: install a clean in-memory localStorage.
//
// Node 22 ships an experimental global Web Storage that collides with jsdom's
// localStorage (window.localStorage.clear ends up undefined). The app reads
// window.localStorage, so we replace it with a deterministic mock that the
// tests and the code under test share.
import { beforeEach } from "vitest";

class LocalStorageMock {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
}

const mock = new LocalStorageMock();
const define = (target: object) =>
  Object.defineProperty(target, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });

define(globalThis);
if (typeof window !== "undefined") define(window);

beforeEach(() => {
  mock.clear();
});
