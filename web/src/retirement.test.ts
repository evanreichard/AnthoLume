import { afterEach, expect, it, vi } from 'vitest';
import { authPath, legacyDocument, retirementDestination } from './retirement';

afterEach(() => vi.unstubAllGlobals());
it('accepts a single bounded opaque ID, never an arbitrary redirect or duplicated intent', () => {
  const id = 'a/plus+percent%書';
  expect(legacyDocument(`?${new URLSearchParams({ legacyDocument: id })}`)).toBe(id);
  expect(legacyDocument('?legacyDocument=one&legacyDocument=two')).toBeNull();
  expect(legacyDocument('?legacyDocument=')).toBeNull();
  expect(legacyDocument(`?legacyDocument=${'書'.repeat(129)}`)).toBeNull();
  expect(legacyDocument(`?legacyDocument=${'書'.repeat(128)}`)).toBe('書'.repeat(128));
  expect(authPath('login', id)).toBe(`/login?${new URLSearchParams({ legacyDocument: id })}`);
});
it('selects no account before authentication and never accepts a foreign origin/account from URL intent', () => {
  vi.stubGlobal('window', { location: { origin: 'https://books.example' } });
  const account = { origin: 'https://books.example', userId: 'authorized-account' };
  for (const kind of ['loading', 'anonymous'] as const) expect(retirementDestination('book', { kind })).toBeNull();
  expect(retirementDestination('book', { kind: 'expired', account })).toBeNull();
  expect(retirementDestination('book', { kind: 'logout', account })).toBeNull();
  expect(retirementDestination('book', { kind: 'authenticated', account: { ...account, origin: 'https://other.example' } })).toBeNull();
  expect(retirementDestination('a/b', { kind: 'authenticated', account })).toBe('/read/server?id=a%2Fb&account=authorized-account&origin=https%3A%2F%2Fbooks.example');
});
