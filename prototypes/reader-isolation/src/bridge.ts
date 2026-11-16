export const noncePattern = /^[a-f0-9]{32}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function exact(v: unknown, keys: string[]): v is Record<string, unknown> {
  return record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
}
const text = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length <= max;
const md5 = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
export function validObservation(v: unknown, nonce: string): boolean {
  if (!record(v) || v.nonce !== nonce || !noncePattern.test(nonce)) return false;
  if (v.type === 'boot') return exact(v, ['type', 'nonce', 'origin', 'parentDOM', 'storage', 'cookie']) && v.origin === 'null' && v.parentDOM === false && v.storage === false && v.cookie === false;
  if (v.type === 'codec') return exact(v, ['type', 'nonce', 'path', 'ok', 'cfi']) && text(v.path) && typeof v.ok === 'boolean' && text(v.cfi);
  if (v.type === 'identity') return exact(v, ['type', 'nonce', 'partial', 'full', 'bytes']) && md5(v.partial) && md5(v.full) && Number.isSafeInteger(v.bytes) && (v.bytes as number) > 0 && (v.bytes as number) <= 8 * 1024 * 1024;
  if (v.type === 'render') return exact(v, ['type', 'nonce', 'outcome']) && ['passive-frame-dom-unavailable', 'unexpected-dom-access', 'open-rejected'].includes(String(v.outcome));
  return false;
}
export function validCommand(v: unknown, nonce: string): boolean {
  if (!record(v) || v.nonce !== nonce || !noncePattern.test(nonce)) return false;
  if (v.type === 'open') return exact(v, ['type', 'nonce', 'bytes']) && v.bytes instanceof ArrayBuffer && v.bytes.byteLength > 0 && v.bytes.byteLength <= 8 * 1024 * 1024;
  return v.type === 'codec' && exact(v, ['type', 'nonce', 'path']) && text(v.path);
}
export function trustedObservation(event: Pick<MessageEvent, 'data' | 'origin' | 'source'>, source: MessageEventSource | null, nonce: string) {
  return source !== null && event.source === source && event.origin === 'null' && validObservation(event.data, nonce);
}
