import { describe, expect, it } from 'vitest';
import {
  InvalidResponse,
  isAdminAutoImport,
  isAdminRestore,
  isInsightActivity,
  isCapabilities,
  isDocument,
  isPage,
  isProblem,
  isSession,
  isState,
  revision,
  validated,
} from './validate';

const document = {
  id: 'opaque/id',
  title: '<script>untrusted</script>',
  author: null,
  series: null,
  description: '<b>text only</b>',
  lang: null,
  file_available: true,
  cover_available: false,
  media_type: 'application/epub+zip',
  file_size_bytes: 10,
};
describe('consumed HTTP DTO validation', () => {
  it('rejects malformed or over-permissive session/capability bodies', () => {
    const anonymous = { user: null, csrf_token: 'a'.repeat(32), expires_at: null };
    expect(isSession(anonymous)).toBe(true);
    expect(isSession({ ...anonymous, csrf_token: '' })).toBe(false);
    expect(isSession({ ...anonymous, csrf_token: 'a'.repeat(31) })).toBe(false);
    expect(isSession({ ...anonymous, csrf_token: 'a'.repeat(129) })).toBe(false);
    expect(isSession({ ...anonymous, user: { id: 'a', is_admin: 'true', timezone: 'UTC' } })).toBe(false);
    expect(isSession({ ...anonymous, expires_at: '2026-02-31T00:00:00Z' })).toBe(false);
    const user = {
      user: {
        id: 'a',
        account_id: 'fe43a87f-48b6-43ef-afda-1ef2654c0844',
        reading_generation: 'a'.repeat(32),
        is_admin: false,
        timezone: 'UTC',
      },
      csrf_token: 'b'.repeat(128),
      expires_at: '2026-01-01T01:02:03.123456Z',
    };
    expect(isSession(user)).toBe(true);
    for (const account_id of [
      undefined,
      user.user.id,
      user.user.account_id.toUpperCase(),
      user.user.account_id.replace('-43ef-', '-13ef-'),
    ]) {
      expect(isSession({ ...user, user: { ...user.user, account_id } })).toBe(false);
    }
    expect(isSession({ ...user, expires_at: '2026-02-31T01:02:03Z' })).toBe(false);
    expect(isSession({ ...anonymous, permissions: [] })).toBe(false);
    expect(isCapabilities({ registration_enabled: false, search_enabled: true })).toBe(true);
    expect(isCapabilities({ registration_enabled: false, search_enabled: 0 })).toBe(false);
  });
  it('accepts untrusted description as text but validates closed document/page structure', () => {
    expect(isDocument(document)).toBe(true);
    expect(isDocument({ ...document, file_available: 'yes' })).toBe(false);
    expect(isDocument({ ...document, file_size_bytes: -1 })).toBe(false);
    expect(isDocument({ ...document, id: '' })).toBe(false);
    const page = { items: [document], total: 2, page: 1, page_size: 24, next_page: 2 };
    expect(isPage(page)).toBe(true);
    expect(isPage({ ...page, next_page: 1 })).toBe(false);
    expect(isPage({ ...page, items: [document, document] })).toBe(false);
    expect(isPage({ ...page, total: 0 })).toBe(false);
    expect(isPage({ ...page, page_size: 101 })).toBe(false);
  });
  it('preserves exact decimal revisions and finite fractions, never coercing state', () => {
    const state = {
      document_id: 'book',
      revision: '999999999999999999',
      position: '/body/p[1]',
      fraction: 0.2,
      device_id: 'device',
      updated_at: '2026-01-01T00:00:00Z',
    };
    expect(isState(state)).toBe(true);
    for (const value of ['01', '-1', '1e1', '1000000000000000000', 1]) expect(revision(value)).toBe(false);
    for (const value of [NaN, Infinity, 10, -0.1, '0.2']) expect(isState({ ...state, fraction: value })).toBe(false);
    expect(isState({ ...state, position: 'x'.repeat(4097) })).toBe(false);
  });
  it('enforces restore and nested auto-import wire constraints without coercion', () => {
    const restore = { token: 'a'.repeat(64), files: 50000 };
    expect(isAdminRestore(restore)).toBe(true);
    for (const files of [-1, 50001, '1', 0.5]) expect(isAdminRestore({ ...restore, files })).toBe(false);
    const settings = {
      name: 'Books',
      root_id: 'incoming',
      enabled: true,
      watch: false,
      interval_minutes: 15,
      reference: true,
    };
    const rule = { id: '0'.repeat(32), status: 'idle', settings };
    expect(isAdminAutoImport([rule])).toBe(true);
    expect(isAdminAutoImport([{ ...rule, settings: { ...settings, interval_minutes: 1441 } }])).toBe(false);
    expect(isAdminAutoImport([{ ...rule, settings: { ...settings, future: true } }])).toBe(false);
    expect(isAdminAutoImport([{ ...rule, last_scan: 'not a timestamp' }])).toBe(false);
  });
  it('requires the insights cursor exactly when another page is available', () => {
    const page = { timezone: 'UTC', items: [], has_more: true };
    expect(isInsightActivity(page)).toBe(false);
    expect(isInsightActivity({ ...page, next_cursor: 'abc' })).toBe(true);
    expect(isInsightActivity({ ...page, has_more: false, next_cursor: 'abc' })).toBe(false);
  });
  it('validates Problem before exposing server errors and never fabricates success', () => {
    const problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'progress_conflict',
      detail: 'Refresh state',
      current_revision: '2',
    };
    expect(isProblem(problem)).toBe(true);
    expect(isProblem({ ...problem, current_revision: '02' })).toBe(false);
    expect(isProblem({ ...problem, sql: 'private' })).toBe(false);
    expect(() => validated({ ok: true }, isProblem)).toThrow(InvalidResponse);
  });
});
