/** Tiny IndexedDB wrapper: this device's working copy. When signed in, cloud.ts also syncs it to Supabase. */

const DB_NAME = "tally";
// 2: adds "incomes". 3: adds "outbox" (changes waiting to sync). 4: adds "recurringIncomes".
// New stores are created on upgrade; existing data is untouched.
const DB_VERSION = 4;
export const STORES = ["expenses", "chips", "budgets", "bills", "accounts", "goals", "incomes", "recurringIncomes", "kv", "outbox"] as const;
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
          db.createObjectStore(name, { keyPath: name === "kv" || name === "outbox" ? "key" : name === "budgets" ? "category" : "id" });
        }
      }
    };
    // A Tally tab still open on the previous version holds the database until it's closed.
    req.onblocked = () => window.dispatchEvent(new Event("tally:db-blocked"));
    req.onsuccess = () => {
      // A newer release needs to upgrade the database: let it, and reload this tab onto the new code.
      req.result.onversionchange = () => { req.result.close(); location.reload(); };
      resolve(req.result);
    };
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
  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return tx<T>(store, "readonly", (s) => s.get(key) as IDBRequest<T>);
  },
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
  /** Clears `replace` stores and writes `rows` in one transaction: if anything fails, nothing changes. */
  async replaceAll(replace: StoreName[], rows: Partial<Record<StoreName, unknown[]>>): Promise<void> {
    const database = await open();
    const names = [...new Set([...replace, ...(Object.keys(rows) as StoreName[])])];
    await new Promise<void>((resolve, reject) => {
      const t = database.transaction(names, "readwrite");
      for (const name of replace) t.objectStore(name).clear();
      for (const [name, values] of Object.entries(rows) as [StoreName, unknown[]][]) {
        const s = t.objectStore(name);
        values.forEach((v) => s.put(v));
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error("Restore was cancelled"));
    });
  },
};
