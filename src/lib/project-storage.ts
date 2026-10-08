import type { PersistStorage } from "zustand/middleware";

let database: Promise<IDBDatabase> | undefined;
export type StorageStatus = "idle" | "saving" | "saved" | "error";
let status: StorageStatus = "idle";
const listeners = new Set<() => void>();
export const storageStatus = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => status,
  getServerSnapshot: (): StorageStatus => "idle",
};
function report(next: StorageStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}
function openDatabase(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("Browser storage is unavailable."));
        return;
      }
      const request = indexedDB.open("mcpmint-projects", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("projects");
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new Error("Close other mcpmint tabs to unlock browser storage."),
        );
    }).catch((error) => {
      database = undefined;
      throw error;
    });
  return database;
}
async function transact<T>(
  key: string,
  operation: "get" | "put" | "delete",
  value?: unknown,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      "projects",
      operation === "get" ? "readonly" : "readwrite",
    );
    const store = transaction.objectStore("projects");
    const request =
      operation === "put"
        ? store.put(value, key)
        : operation === "delete"
          ? store.delete(key)
          : store.get(key);
    transaction.oncomplete = () => resolve(request.result as T);
    transaction.onabort = () =>
      reject(
        transaction.error ||
          request.error ||
          new Error("Browser storage transaction failed."),
      );
    transaction.onerror = () => reject(transaction.error || request.error);
  });
}
export async function readStored<T>(key: string): Promise<T | null> {
  const stored = await transact<T | undefined>(key, "get");
  if (stored !== undefined) return stored;
  // Migrate existing users only after the IndexedDB transaction has committed.
  const legacy = localStorage.getItem(key);
  if (!legacy) return null;
  const value = JSON.parse(legacy) as T;
  await writeStored(key, value);
  localStorage.removeItem(key);
  return value;
}
export async function writeStored(key: string, value: unknown): Promise<void> {
  await transact(key, "put", value);
}
export async function removeStored(key: string): Promise<void> {
  await transact(key, "delete");
  try {
    localStorage.removeItem(key);
  } catch {
    /* IndexedDB removal succeeded. */
  }
}
export function createProjectStorage<S>(validate?: (state: S) => Promise<S>): PersistStorage<S> {
  let pending: { key: string; value: unknown } | undefined;
  let queued = false;
  let previous: Parameters<PersistStorage<S>["setItem"]>[1] | undefined;
  const flush = async () => {
    queued = false;
    if (!pending) return;
    const entry = pending;
    pending = undefined;
    try {
      await writeStored(entry.key, entry.value);
      if (!pending) report("saved");
    } catch {
      report("error");
    }
  };
  if (typeof window !== "undefined")
    window.addEventListener("pagehide", () => {
      void flush();
    });
  return {
    async getItem(key) {
      try {
        const stored = await readStored<Parameters<PersistStorage<S>["setItem"]>[1]>(key);
        if (stored && validate) return { ...stored, state: await validate(stored.state) };
        return stored;
      } catch {
        report("error");
        return null;
      }
    },
    setItem(key, value) {
      // Coalesce synchronous actions, then start the transaction in the same event turn.
      // A timed debounce can lose the newest selection during an immediate refresh.
      const state = value.state as Record<string, unknown>;
      const prior = previous?.state as Record<string, unknown> | undefined;
      if (
        prior &&
        previous?.version === value.version &&
        Object.keys(state).every((field) => state[field] === prior[field])
      )
        return;
      previous = value;
      pending = { key, value };
      report("saving");
      if (!queued) {
        queued = true;
        queueMicrotask(() => {
          void flush();
        });
      }
    },
    async removeItem(key) {
      pending = undefined;
      previous = undefined;
      try {
        await removeStored(key);
        report("idle");
      } catch {
        report("error");
      }
    },
  };
}
