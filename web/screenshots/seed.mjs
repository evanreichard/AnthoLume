import { randomUUID } from 'node:crypto';
import { books } from './books.mjs';

export async function seedLibrary(context, origin, credentials, { signal } = {}) {
  const headers = { Origin: origin };
  async function request(method, path, data, type = 'application/json') {
    signal?.throwIfAborted();
    const response = await context.fetch(`${origin}/api/v1${path}`, { method, headers: { ...headers, 'Content-Type': type }, data });
    if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  }
  headers['X-CSRF-Token'] = (await request('GET', '/session')).csrf_token;
  const session = await request('POST', '/session/register', credentials);
  headers['X-CSRF-Token'] = session.csrf_token;
  headers['X-AnthoLume-Account'] = session.user.account_id;
  headers['X-AnthoLume-Reading-Generation'] = session.user.reading_generation;

  const docs = [];
  for await (const { title, author, bytes, cover } of books({ signal })) {
    const doc = await request('POST', '/documents', bytes, 'application/epub+zip');
    await request('PATCH', '/documents/' + doc.id, { title, author, description: doc.description || '', isbn10: '', isbn13: '', cover_base64: cover });
    docs.push({ id: doc.id, title });
  }
  return {
    docs,
    async addReadingHistory(now) {
      const device = 'paperwhite';
      await request('POST', '/me/devices', { id: device, name: 'Paperwhite' });
      for (let day = 8; day >= 0; day--) {
        const start = new Date(+now - day * 86_400_000 - 3_600_000).toISOString();
        const fraction = (9 - day) * .04;
        await request('POST', '/me/activity', { event_id: randomUUID(), device_id: device, document_id: docs[day % 3].id,
          start_time: start, duration: (18 + day * 3) * 60, start_fraction: fraction - .035, end_fraction: fraction });
      }
      // Reader Anchor - This points to the chapter heading in the pinned Alice edition.
      await request('POST', '/me/reading-progress', { event_id: randomUUID(), document_id: docs[0].id, device_id: device,
        observed_at: now.toISOString(), base_revision: '0', position: '/body/DocFragment[7]/body/div/h2', fraction: .36 });
    },
  };
}
