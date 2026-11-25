import { randomUUID } from 'node:crypto';
import { request as playwrightRequest } from '@playwright/test';
import { books } from './books.mjs';
import { readingSessions } from './history.mjs';

async function register(context, origin, credentials, signal) {
  const headers = { Origin: origin };
  async function request(method, path, data, type = 'application/json') {
    signal?.throwIfAborted();
    const response = await context.fetch(`${origin}/api/v1${path}`, {
      method,
      headers: { ...headers, 'Content-Type': type },
      data,
    });
    try {
      if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
      return await response.json();
    } finally {
      await response.dispose();
    }
  }
  headers['X-CSRF-Token'] = (await request('GET', '/session')).csrf_token;
  const session = await request('POST', '/session/register', credentials);
  headers['X-CSRF-Token'] = session.csrf_token;
  headers['X-AnthoLume-Account'] = session.user.account_id;
  headers['X-AnthoLume-Reading-Generation'] = session.user.reading_generation;
  return request;
}

async function addHistory(request, docs, readerIndex, now) {
  const device = readerIndex === 0 ? { id: 'paperwhite', name: 'Paperwhite' } : { id: 'libra', name: 'Kobo Libra' };
  await request('POST', '/me/devices', device);
  const revisions = new Map();
  for (const { bookIndex, start, durations, startFraction, pageFraction, position } of readingSessions(
    readerIndex,
    now,
  )) {
    const document_id = docs[bookIndex].id;
    let time = +start;
    let fraction = startFraction;
    for (const [page, duration] of durations.entries()) {
      const end = startFraction + (page + 1) * pageFraction;
      await request('POST', '/me/activity', {
        event_id: randomUUID(),
        device_id: device.id,
        document_id,
        start_time: new Date(time).toISOString(),
        duration,
        start_fraction: fraction,
        end_fraction: end,
      });
      time += duration * 1000;
      fraction = end;
    }
    const receipt = await request('POST', '/me/reading-progress', {
      event_id: randomUUID(),
      device_id: device.id,
      document_id,
      observed_at: new Date(time).toISOString(),
      base_revision: revisions.get(document_id) ?? '0',
      position,
      fraction,
    });
    revisions.set(document_id, receipt.revision);
  }
}

export async function seedLibrary(context, origin, password, { signal } = {}) {
  const robin = await register(context, origin, { username: 'robin', password }, signal);
  const docs = [];
  for await (const { title, author, description, bytes, cover } of books({ signal })) {
    const doc = await robin('POST', '/documents', bytes, 'application/epub+zip');
    await robin('PATCH', '/documents/' + doc.id, {
      title,
      author,
      description,
      isbn10: doc.isbn10 ?? '',
      isbn13: doc.isbn13 ?? '',
      cover_base64: cover,
    });
    docs.push({ id: doc.id, title, description });
  }
  return {
    docs,
    async addReadingHistory(now = new Date()) {
      await addHistory(robin, docs, 0, now);
      const secondContext = await playwrightRequest.newContext({ timeout: 10_000 });
      try {
        const sam = await register(secondContext, origin, { username: 'sam', password }, signal);
        await addHistory(sam, docs, 1, now);
      } finally {
        await secondContext.dispose();
      }
      await robin('POST', '/admin/jobs', { kind: 'statistics' });
    },
  };
}
