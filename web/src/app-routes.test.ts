import { expect, test } from 'vitest';
import { matchesShell, shellPaths } from './app-routes';

const pages = new Set(shellPaths());

test('shell navigation includes index, nested and concrete reader pages', () => {
  for (const path of ['/', '/settings', '/admin', '/admin/library/', '/admin/logs', '/insights', '/insights/activity', '/insights/progress', '/insights/rankings', '/books/server', '/books/local', '/read/server/', '/read/local']) {
    expect(matchesShell(pages, path), path).toBe(true);
  }
});

test('the client catch-all does not expand the shell to unknown paths', () => {
  for (const path of ['/api/v1/session', '/admin/typo', '/read/other', '/read/:kind', '/read%2Flocal', '/settings//', '//', '/*']) {
    expect(matchesShell(pages, path), path).toBe(false);
  }
});
