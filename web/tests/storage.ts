import type { Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

type Row = { server?: unknown; currentRevision?: string; refreshError?: string | null; key?: string; epoch?: number; authenticated?: boolean; eligible?: boolean; owner?: string; fence?: number; until?: number; scope?: string; ids?: string[]; id?: string; kind?: string; payload?: { event_id: string; base_revision?: string; duration?: number; position?: string }; outcome?: string; receipt?: { event_id: string }; ref?: { kind: string; documentId?: string }; checkpoint?: { position: string | null; fraction: number | null } };
export async function storedRows(page: Page, store: 'events' | 'decisions' | 'books' | 'access' | 'leases' | 'conflicts'): Promise<Row[]> {
  return page.evaluate((name) => new Promise<Row[]>((resolve, reject) => {
    const request = indexedDB.open('antholume-reading-v1');
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Production reader DB missing')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(name, 'readonly');
      const result = tx.objectStore(name).getAll();
      tx.oncomplete = () => { db.close(); resolve(result.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), store);
}

export async function pendingIds(page: Page) {
  const [events, decisions] = await Promise.all([storedRows(page, 'events'), storedRows(page, 'decisions')]);
  const decided = new Set(decisions.map((row) => row.id));
  return events.filter((row) => !decided.has(row.id)).map((row) => row.id!);
}
export function serverEffects(data: string, user: string) {
  const db = new DatabaseSync(`${data}/browser.db`, { readOnly: true });
  try {
    return {
      receipts: db.prepare('SELECT event_id,kind,status,revision FROM reading_receipts WHERE user_id=? ORDER BY event_id').all(user),
      activity: db.prepare('SELECT count(*) AS count FROM activity WHERE user_id=?').get(user)!.count as number,
      activitySeconds: db.prepare('SELECT coalesce(sum(duration),0) AS seconds FROM activity WHERE user_id=?').get(user)!.seconds as number,
      head: db.prepare('SELECT revision,position,fraction FROM reading_heads WHERE user_id=? AND document_id=?').get(user, 'book-001'),
    };
  } finally { db.close(); }
}
