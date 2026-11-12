// Browser persistence: save slots in IndexedDB (gzip-compressed when the browser can), file export/import.
// Every call is defensive: storage can be unavailable in private windows and embedded viewers.
import type { SlotInfo } from './ui';

const DB = 'genesis-saves';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'slot' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

export async function gzip(text: string): Promise<Blob> {
  const CS = (globalThis as any).CompressionStream;
  if (!CS) return new Blob([text], { type: 'application/json' });
  const stream = new Blob([text]).stream().pipeThrough(new CS('gzip'));
  return new Response(stream).blob();
}

export async function gunzip(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return blob.text();
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) throw new Error('This browser cannot open compressed saves.');
  return new Response(blob.stream().pipeThrough(new DS('gzip'))).text();
}

export async function putSave(info: SlotInfo, json: string): Promise<void> {
  const blob = await gzip(json);
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['meta', 'data'], 'readwrite');
    tx.objectStore('meta').put(info);
    tx.objectStore('data').put(blob, info.slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function getSave(slot: string): Promise<string | null> {
  const db = await open();
  const blob = await new Promise<Blob | string | undefined>((resolve, reject) => {
    const rq = db.transaction('data', 'readonly').objectStore('data').get(slot);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
  db.close();
  if (blob === undefined || blob === null) return null;
  return typeof blob === 'string' ? blob : gunzip(blob);
}

export async function listSaves(): Promise<SlotInfo[]> {
  const db = await open();
  const out = await new Promise<SlotInfo[]>((resolve, reject) => {
    const rq = db.transaction('meta', 'readonly').objectStore('meta').getAll();
    rq.onsuccess = () => resolve(rq.result as SlotInfo[]);
    rq.onerror = () => reject(rq.error);
  });
  db.close();
  return out;
}

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
