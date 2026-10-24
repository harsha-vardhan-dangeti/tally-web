/** Tiny IndexedDB wrapper. Everything stays in this browser — no server. */

const DB_NAME = "tally";
const DB_VERSION = 1;
export const STORES = ["expenses", "chips", "budgets", "bills", "accounts", "goals", "kv"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === "kv" ? "key" : name === "budgets" ? "category" : "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const db = {
  all<T>(store: StoreName): Promise<T[]> {
    return tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>).then((r) => r ?? []);
  },
  put<T>(store: StoreName, value: T): Promise<unknown> {
    return tx(store, "readwrite", (s) => s.put(value));
  },
  delete(store: StoreName, key: string): Promise<unknown> {
    return tx(store, "readwrite", (s) => s.delete(key));
  },
  clear(store: StoreName): Promise<unknown> {
    return tx(store, "readwrite", (s) => s.clear());
  },
  async putMany<T>(store: StoreName, values: T[]): Promise<void> {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const t = database.transaction(store, "readwrite");
      const s = t.objectStore(store);
      values.forEach((v) => s.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
};
