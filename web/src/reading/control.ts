export type Marker = { key: 'retirement/legacy-v1'; epoch: 1; phase: 'pending' | 'retiring' | 'cleaning' | 'done'; owner: string; fence: number; until: number; build: string };
type ClientRecord = { key: string; clientId: string; attempted: boolean };
export type ControlRecord = Marker | ClientRecord;
export function validMarker(value: unknown): value is Marker {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'build,epoch,fence,key,owner,phase,until') return false;
  const m = value as Marker;
  return m.key === 'retirement/legacy-v1' && m.epoch === 1 && ['pending', 'retiring', 'cleaning', 'done'].includes(m.phase) && typeof m.owner === 'string' && m.owner.length > 0 && m.owner.length <= 128 && Number.isSafeInteger(m.fence) && m.fence > 0 && Number.isFinite(m.until) && m.until >= 0 && typeof m.build === 'string' && m.build.length > 0 && m.build.length <= 128;
}
export function openControl(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const request = indexedDB.open('antholume-app-control-v1', 1), timer = setTimeout(() => { expired = true; reject(new Error('Control database blocked; close old app tabs and retry')); }, 10000);
    request.onupgradeneeded = () => request.result.createObjectStore('meta', { keyPath: 'key' });
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onsuccess = () => { clearTimeout(timer); if (expired) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
export async function controlTransaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, set: (result: T) => void) => void): Promise<T> {
  const db = await openControl();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', mode); let result: T;
    const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(new Error('Control transaction deadline')); }, 10000);
    tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { clearTimeout(timer); db.close(); reject(tx.error || new Error('Control transaction aborted')); };
    try { run(tx.objectStore('meta'), value => { result = value; }); } catch (error) { tx.abort(); reject(error); }
  });
}
export function getMarker() { return controlTransaction<Marker | undefined>('readonly', (store, set) => { const r = store.get('retirement/legacy-v1'); r.onsuccess = () => set(validMarker(r.result) ? r.result : undefined); }); }
export function claimRetirement(owner: string, build: string) {
  return controlTransaction<Marker | null>('readwrite', (store, set) => {
    const r = store.get('retirement/legacy-v1'); r.onsuccess = () => {
      const old = validMarker(r.result) ? r.result : undefined;
      if (old?.phase === 'done') { set(old); return; }
      if (old && old.until > Date.now() && old.owner !== owner) { set(null); return; }
      const marker: Marker = { key: 'retirement/legacy-v1', epoch: 1, phase: old?.phase || 'pending', fence: (old?.fence || 0) + 1, owner, build, until: Date.now() + 30000 };
      store.put(marker); set(marker);
    };
  });
}
export function advanceRetirement(marker: Marker, phase: Marker['phase']) {
  return controlTransaction<Marker>('readwrite', (store, set) => {
    const r = store.get(marker.key); r.onsuccess = () => {
      const old = validMarker(r.result) ? r.result : undefined;
      if (!old || old.owner !== marker.owner || old.fence !== marker.fence || old.until <= Date.now() || old.build !== marker.build) { store.transaction.abort(); return; }
      const next = { ...old, phase }; store.put(next); set(next);
    };
  });
}
export async function cleanLegacyKeys() {
  // Selective Cleanup - Never create the generic database just to clean it, and never delete unknown stores/keys.
  const names = await indexedDB.databases();
  if (!names.some(db => db.name === 'keyval-store')) return;
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.open('keyval-store'); let settled = false, absent = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('Legacy storage blocked; close old readers and retry')); }, 30000);
    r.onupgradeneeded = () => { absent = true; r.transaction!.abort(); };
    r.onerror = () => { clearTimeout(timer); if (absent) resolve(); else reject(r.error); };
    r.onsuccess = () => {
      const db = r.result;
      if (settled) { db.close(); return; }
      if (!db.objectStoreNames.contains('keyval')) { clearTimeout(timer); db.close(); resolve(); return; }
      const tx = db.transaction('keyval', 'readwrite'), cursor = tx.objectStore('keyval').openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (typeof c.key === 'string' && (c.key === 'ACTIVITY' || /^(?:FILE-|FILE-METADATA-|PROGRESS-)[a-f0-9]{32}$/i.test(c.key))) c.delete(); c.continue(); };
      tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); db.close(); reject(tx.error); };
    };
  });
}
