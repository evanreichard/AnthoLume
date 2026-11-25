type Init = { kind: 'init'; database: string; sourceId: string; received: number; chunkNumber: number };
type Input = { kind: 'input'; bytes: ArrayBuffer; offset: number; length: number; final: boolean };
type Grant = { kind: 'grant'; id: number; error?: { name: string; message: string } };
const host = globalThis as unknown as {
  onmessage: (event: MessageEvent<Init | Input | Grant>) => void;
  postMessage(value: unknown): void;
};
let database: IDBDatabase,
  sourceId: string,
  received = 0,
  chunkNumber = 0,
  buffer = new Uint8Array(262144),
  used = 0,
  requestId = 0;
const grants = new Map<number, { resolve(): void; reject(error: Error): void }>();
async function persist() {
  const id = ++requestId,
    key = `${sourceId}:${chunkNumber}`;
  await new Promise<void>((resolve, reject) => {
    grants.set(id, { resolve, reject });
    host.postMessage({ kind: 'reserve', id, key });
  });
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['sources', 'sourceChunks'], 'readwrite'),
      store = tx.objectStore('sources'),
      request = store.get(sourceId);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Staged write aborted'));
    tx.onerror = (event) => {
      event.preventDefault();
      reject(tx.error || new Error('Staged write failed'));
    };
    request.onsuccess = () => {
      try {
        const row = request.result;
        if (!row || row.complete || row.received !== received) {
          tx.abort();
          return;
        }
        tx.objectStore('sourceChunks').put({ key, sourceId, data: buffer.slice(0, used).buffer });
        row.received += used;
        row.size = row.received;
        row.until = Date.now() + 120000;
        store.put(row);
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        reject(error);
      }
    };
  });
  received += used;
  chunkNumber++;
  used = 0;
}
host.onmessage = async (event) => {
  const data = event.data;
  if (data.kind === 'grant') {
    const pending = grants.get(data.id);
    grants.delete(data.id);
    if (data.error) {
      const error = new Error(data.error.message);
      error.name = data.error.name;
      pending?.reject(error);
    } else pending?.resolve();
    return;
  }
  try {
    if (data.kind === 'init') {
      sourceId = data.sourceId;
      received = data.received;
      chunkNumber = data.chunkNumber;
      database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(data.database);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      host.postMessage({ kind: 'ready' });
      return;
    }
    const bytes = new Uint8Array(data.bytes, data.offset, data.length);
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Staging transport chunk budget exceeded');
    for (let offset = 0; offset < bytes.length;) {
      const amount = Math.min(buffer.length - used, bytes.length - offset);
      buffer.set(bytes.subarray(offset, offset + amount), used);
      used += amount;
      offset += amount;
      if (used === buffer.length) await persist();
    }
    if (data.final && used) await persist();
    host.postMessage({ kind: 'written', received, chunkNumber, buffered: used });
  } catch (error) {
    host.postMessage({
      kind: 'error',
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : 'Staged write failed',
      },
    });
  }
};
