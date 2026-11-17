// Small Optional Responses - EPUB originals use Repository.stageStream, never this materializer.
export async function boundedStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal, progress?: (received: number) => void, maxBytes = 2 * 1024 * 1024, deadlineMs = 10000): Promise<ArrayBuffer> {
  if (maxBytes > 2 * 1024 * 1024) throw new Error('Small response budget cannot exceed 2 MiB');
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let total = 0, expired = false;
  const abort = () => { void reader.cancel(signal?.reason); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { expired = true; void reader.cancel(); }, deadlineMs);
  try {
    for (;;) { signal?.throwIfAborted(); const { value, done } = await reader.read(); signal?.throwIfAborted(); if (expired) throw new Error('Small response deadline exceeded'); if (done) break; total += value.length; if (total > maxBytes) throw new Error('Small response byte budget exceeded'); chunks.push(value); progress?.(total); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes.buffer;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
