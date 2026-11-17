import type { components } from './schema.gen';

type S = components['schemas'];
type Guard<T> = (value: unknown) => value is T;
export class InvalidResponse extends Error {
  constructor() { super('The server returned an invalid response. Nothing was acknowledged.'); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: string[], optional: string[] = []): value is Record<string, unknown> => object(value) && keys.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => keys.includes(key) || optional.includes(key));
const string = (value: unknown): value is string => typeof value === 'string';
const id = (value: unknown): value is string => string(value) && value.length > 0 && value.length <= 128;
const nullableString = (value: unknown) => value === null || string(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown) => string(value) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const nullableTime = (value: unknown) => value === null || timestamp(value);
export const revision = (value: unknown): value is string => string(value) && /^(0|[1-9][0-9]{0,17})$/.test(value);
const fraction = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export const isSession: Guard<S['Session']> = (value): value is S['Session'] => {
  if (!exact(value, ['user', 'csrf_token', 'expires_at']) || !string(value.csrf_token) || value.csrf_token.length < 32 || value.csrf_token.length > 128 || !nullableTime(value.expires_at)) return false;
  if (value.user === null) return value.expires_at === null;
  return exact(value.user, ['id', 'is_admin', 'timezone']) && id(value.user.id) && typeof value.user.is_admin === 'boolean' && string(value.user.timezone) && timestamp(value.expires_at);
};
export const isCapabilities: Guard<S['Capabilities']> = (value): value is S['Capabilities'] => exact(value, ['registration_enabled', 'search_enabled', 'demo_mode']) && Object.values(value).every((entry) => typeof entry === 'boolean');
export const isDocument: Guard<S['Document']> = (value): value is S['Document'] => exact(value, ['id', 'title', 'author', 'series', 'description', 'lang', 'file_available', 'cover_available', 'media_type', 'file_size_bytes']) && id(value.id) && ['title', 'author', 'series', 'description', 'lang', 'media_type'].every((key) => nullableString(value[key])) && typeof value.file_available === 'boolean' && typeof value.cover_available === 'boolean' && (value.file_size_bytes === null || integer(value.file_size_bytes));
export const isPage: Guard<S['DocumentPage']> = (value): value is S['DocumentPage'] => exact(value, ['items', 'total', 'page', 'page_size', 'next_page']) && Array.isArray(value.items) && value.items.every(isDocument) && integer(value.total) && integer(value.page) && value.page >= 1 && integer(value.page_size) && value.page_size >= 1 && value.page_size <= 100 && value.items.length <= value.page_size && new Set(value.items.map((item) => item.id)).size === value.items.length && value.items.length <= value.total && (value.next_page === null || integer(value.next_page) && value.next_page === value.page + 1);
export const isState: Guard<S['ReadingState']> = (value): value is S['ReadingState'] => exact(value, ['document_id', 'revision', 'position', 'fraction', 'device_id', 'updated_at']) && id(value.document_id) && revision(value.revision) && nullableString(value.position) && (value.position === null || (value.position as string).length <= 4096) && fraction(value.fraction) && (value.device_id === null || id(value.device_id)) && nullableTime(value.updated_at);
export const isDevice: Guard<S['Device']> = (value): value is S['Device'] => exact(value, ['id', 'name']) && id(value.id) && string(value.name) && value.name.length > 0 && value.name.length <= 128;
export const isProblem: Guard<S['Problem']> = (value): value is S['Problem'] => exact(value, ['type', 'title', 'status', 'code', 'detail'], ['current_revision']) && ['type', 'title', 'code', 'detail'].every((key) => string(value[key])) && integer(value.status) && value.status >= 400 && value.status <= 599 && (!Object.hasOwn(value, 'current_revision') || revision(value.current_revision));
export function validated<T>(value: unknown, guard: Guard<T>): T {
  if (!guard(value)) throw new InvalidResponse();
  return value;
}
