import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { invalidateBook, invalidateLibraryAvailability } from './catalogQueries';

it('invalidates book and availability queries without discarding data or crossing account generations', async () => {
  const client = new QueryClient();
  const account = { origin: 'https://books.example', userId: 'a' };
  const ref = { kind: 'server' as const, account, documentId: 'one' };
  const other = { ...ref, documentId: 'two' };
  const nextGeneration = { ...account, readingGeneration: 'restored' };
  const items = [
    [['document', ref], true, true],
    [['document', other], false, true],
    [['cover', ref], true, false],
    [['cover', other], false, false],
    [['documents', account, 'search', 'title'], true, true],
    [['documents', account, 'matcher', 1], true, true],
    [['library-resume', account], true, true],
    [['insight-activity', account, '2026-01-01'], true, false],
    [['insight-progress', account], true, false],
    [['reading-state', ref], false, false],
    [['documents', { ...account, userId: 'b' }], false, false],
    [['documents', nextGeneration], false, false],
    [['document', { ...ref, account: nextGeneration }], false, false],
    [['cover', { kind: 'local', localId: 'one' }], false, false],
  ] as const;

  for (const [action, expectedIndex] of [
    [() => invalidateBook(client, ref), 1],
    [() => invalidateLibraryAvailability(client, account), 2],
  ] as const) {
    for (const [key] of items) client.setQueryData(key, 'cached');
    await action();
    for (const item of items) {
      expect(client.getQueryState(item[0]), JSON.stringify(item[0])).toMatchObject({ data: 'cached', isInvalidated: item[expectedIndex] });
    }
  }
  client.clear();
});
