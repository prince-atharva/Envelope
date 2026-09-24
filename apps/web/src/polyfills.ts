/**
 * Newer built-ins pdf.js 6 calls, for browsers that do not have them yet.
 *
 * Main thread only: the pdf.js worker runs in its own global scope, so a browser
 * missing these still fails inside the worker. Imported first in main.tsx.
 */

declare global {
  // ES2024; the app's TypeScript lib stops at ES2023.
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}

// Map.prototype.getOrInsertComputed (TC39 "upsert" proposal).
if (!('getOrInsertComputed' in Map.prototype)) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value(this: Map<unknown, unknown>, key: unknown, callback: (key: unknown) => unknown): unknown {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    },
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

// Map.prototype.getOrInsert, from the same proposal.
if (!('getOrInsert' in Map.prototype)) {
  Object.defineProperty(Map.prototype, 'getOrInsert', {
    value(this: Map<unknown, unknown>, key: unknown, defaultValue: unknown): unknown {
      if (this.has(key)) return this.get(key);
      this.set(key, defaultValue);
      return defaultValue;
    },
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

// Promise.withResolvers (ES2024).
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
