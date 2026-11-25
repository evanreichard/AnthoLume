import { checkID, checkMetadataEditionID, checkMetadataProvider, checkMetadataWorkID } from './guards.gen.js';
import type { components } from './schema.gen';
import { InvalidResponse } from './validate';

type S = components['schemas'];
export type MatcherProvider = S['MetadataProvider'];
export type MatcherBook = S['Document'] & { matches: S['DocumentMatch'][] };
export type MatcherPage = Omit<S['DocumentPage'], 'items'> & { items: MatcherBook[] };
export type MatcherCandidate = S['BookMatcherCandidate'];
export type MatcherLink = S['BookMatcherLink'];
export type MatcherResult = { document_id: string } & (
  { candidates: MatcherCandidate[] } | { error: string } | { match: MatcherLink }
);

export function matcherLink(provider: MatcherProvider, work_id: string): MatcherLink {
  const base = provider === 'hardcover' ? 'https://hardcover.app/id/book/' : 'https://openlibrary.org/works/';
  return { work_id, url: base + encodeURIComponent(work_id) };
}

function isCatalogURL(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.origin === 'https://openlibrary.org' || url.origin === 'https://hardcover.app')
    );
  } catch {
    return false;
  }
}

export function matcherLookupRequest(provider: MatcherProvider, document_ids: string[]): S['BookMatcherLookupRequest'] {
  if (
    !checkMetadataProvider(provider) ||
    document_ids.length < 1 ||
    document_ids.length > 10 ||
    new Set(document_ids).size !== document_ids.length ||
    !document_ids.every(checkID)
  ) {
    throw new TypeError('Expected one to ten distinct document IDs and a supported provider.');
  }
  return { provider, document_ids: [...document_ids] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCandidate(value: unknown): value is MatcherCandidate {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) =>
      ['work_id', 'title', 'author', 'url', 'reason', 'edition_id', 'isbn'].includes(key),
    ) &&
    checkMetadataWorkID(value.work_id) &&
    typeof value.title === 'string' &&
    typeof value.author === 'string' &&
    isCatalogURL(value.url) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.edition_id === undefined || checkMetadataEditionID(value.edition_id)) &&
    (value.isbn === undefined ||
      (value.edition_id !== undefined &&
        typeof value.isbn === 'string' &&
        /^(?:[0-9]{13}|[0-9]{9}[0-9X])$/.test(value.isbn)))
  );
}

function decodeOutcome(line: string): MatcherResult {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new InvalidResponse();
  }
  if (!isRecord(value) || Object.keys(value).length !== 2 || !checkID(value.document_id)) throw new InvalidResponse();
  const { document_id, candidates, error, match } = value;
  if (Array.isArray(candidates) && candidates.every(isCandidate)) return { document_id, candidates };
  if (typeof error === 'string' && error.length > 0) return { document_id, error };
  if (
    isRecord(match) &&
    Object.keys(match).length === 2 &&
    checkMetadataWorkID(match.work_id) &&
    isCatalogURL(match.url)
  ) {
    return { document_id, match: { work_id: match.work_id, url: match.url } };
  }
  throw new InvalidResponse();
}

const maxLineLength = 256 * 1024;

export async function readMatcherResults(
  body: ReadableStream<Uint8Array>,
  ids: readonly string[],
  signal: AbortSignal,
  onResult: (result: MatcherResult) => void,
) {
  const remaining = new Set(ids);
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let done = false;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (!done) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      done = chunk.done;
      try {
        pending += decoder.decode(chunk.value, { stream: !done });
      } catch {
        throw new InvalidResponse();
      }
      let start = 0;
      for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n', start)) {
        signal.throwIfAborted();
        if (end - start > maxLineLength) throw new InvalidResponse();
        const result = decodeOutcome(pending.slice(start, end));
        if (!remaining.delete(result.document_id)) throw new InvalidResponse();
        onResult(result);
        start = end + 1;
      }
      pending = pending.slice(start);
      if (pending.length > maxLineLength) throw new InvalidResponse();
    }
    signal.throwIfAborted();
    if (pending.length || remaining.size) throw new InvalidResponse();
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!done) cancel();
    reader.releaseLock();
  }
}
