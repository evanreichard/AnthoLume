import type { ReadingAccess } from './reading';
import { bookPath } from './library';

export function legacyDocument(search: string): string | null {
  const values = new URLSearchParams(search).getAll('legacyDocument');
  return values.length === 1 && Array.from(values[0]).length >= 1 && Array.from(values[0]).length <= 128 ? values[0] : null;
}
export function retirementDestination(id: string, access: ReadingAccess): string | null {
  if (access.kind !== 'authenticated' || access.account.origin !== window.location.origin) return null;
  return bookPath({ kind: 'server', account: access.account, documentId: id }, 'read');
}
export function authPath(mode: 'login' | 'register', id: string | null): string {
  return `/${mode}${id ? `?${new URLSearchParams({ legacyDocument: id })}` : ''}`;
}
