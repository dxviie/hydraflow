/**
 * The pictures and videos a patch plays, kept in this browser (IndexedDB).
 * A patch only holds a file's id and name, so it stays small enough to save,
 * undo and share; the file itself never leaves the computer.
 */
import type { MediaRef } from "./graph/types";

const DATABASE = "hydraflow";
const STORE = "media";

interface StoredMedia {
  id: string;
  name: string;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run one request against the store and close the database again */
async function run<Result>(
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<Result>,
): Promise<Result> {
  const database = await open();
  try {
    return await new Promise<Result>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const pending = request(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(pending.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveMedia(file: File): Promise<MediaRef> {
  const stored: StoredMedia = { id: crypto.randomUUID(), name: file.name, blob: file };
  await run("readwrite", (store) => store.put(stored));
  return { id: stored.id, name: stored.name };
}

/** The file, or nothing when this browser doesn't have it (a patch from someone else) */
export async function loadMedia(id: string): Promise<Blob | undefined> {
  const stored = await run<StoredMedia | undefined>("readonly", (store) => store.get(id));
  return stored?.blob;
}

/** Forget every file the patch no longer names */
export async function pruneMedia(keep: Set<string>): Promise<void> {
  const ids = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
  for (const id of ids) {
    if (!keep.has(String(id))) await run("readwrite", (store) => store.delete(id));
  }
}

/** Which of hydra's file inputs a file is for, if any */
export function mediaKind(file: File): "image" | "video" | undefined {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return undefined;
}
