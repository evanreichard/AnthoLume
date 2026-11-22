const maxCoverBytes = 8 * 1024 * 1024;

export function validCover(cover: Blob) {
  return cover.size > 0 && cover.size <= maxCoverBytes && cover.type.startsWith('image/');
}

export async function readCover(response: Response, signal: AbortSignal): Promise<Blob> {
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || response.redirected || !type.startsWith('image/') || !response.body) {
    await response.body?.cancel();
    throw new Error('Cover unavailable');
  }
  if (Number(response.headers.get('content-length')) > maxCoverBytes) {
    await response.body.cancel();
    throw new Error('Cover too large');
  }
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > maxCoverBytes) throw new Error('Cover too large');
      parts.push(new Uint8Array(part.value));
    }
    if (!bytes) throw new Error('Cover unavailable');
    return new Blob(parts, { type });
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
