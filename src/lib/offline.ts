// A copy of the last forecast inputs in IndexedDB so Today and Forecast can be read offline.
// It is per browser, holds only what the signed-in user could already see, and is deleted on sign-out.
const DB = 'receivia-offline';
const STORE = 'snapshots';
const KEY = 'forecast';

export interface Snapshot<T> {
  orgId: string;
  today: string;
  savedAt: number;
  data: T;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<R>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<R>,
): Promise<R> {
  const db = await open();
  try {
    return await new Promise<R>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSnapshot<T>(s: Snapshot<T>): Promise<void> {
  try {
    await run('readwrite', (st) => st.put(s, KEY));
  } catch {
    /* storage blocked or full: offline reading is a convenience */
  }
}

export async function loadSnapshot<T>(): Promise<Snapshot<T> | null> {
  try {
    return ((await run('readonly', (st) => st.get(KEY))) as Snapshot<T> | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await run('readwrite', (st) => st.delete(KEY));
  } catch {
    /* nothing stored */
  }
}
