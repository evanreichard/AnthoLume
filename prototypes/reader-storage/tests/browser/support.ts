import type { Page } from '@playwright/test';
import type { Submission, Receipt } from '../../src/wire';

type Events = {
  progress(document: string, ko: string, id?: string, base?: string): Submission;
  activity(document: string, id: string, duration?: number): Submission;
  receipt(id: string, kind?: 'progress' | 'activity', revision?: string | null): Receipt;
};
declare global { interface Window { testEvents: Events } }
export async function watchRequests(page: Page, controlledFramePath?: string) {
  const unexpected: string[] = [];
  const allowed = (value: string) => {
    const url = new URL(value);
    if (['blob:', 'data:', 'about:'].includes(url.protocol)) return true;
    return url.origin === 'http://127.0.0.1:5314' && (url.pathname === '/' || ['/fixtures/', '/src/', '/node_modules/', '/@vite/', '/@id/'].some(prefix => url.pathname.startsWith(prefix)));
  };
  const allowedRequest = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url());
    if (['blob:', 'data:', 'about:'].includes(url.protocol)) return true;
    if (request.method() !== 'GET') return false;
    if (controlledFramePath && url.origin === 'http://127.0.0.1:5314' && url.pathname === controlledFramePath) return true;
    return request.frame() === page.mainFrame() && allowed(request.url());
  };
  page.on('request', request => { if (!allowedRequest(request)) unexpected.push(request.url()); });
  await page.route('**/*', route => allowedRequest(route.request()) ? route.continue() : route.abort());
  return unexpected;
}
export async function installEvents(page: Page) {
  await page.evaluate(() => {
    window.testEvents = {
      progress: (document, ko, id = crypto.randomUUID(), base = '0') => ({ kind: 'progress', payload: { event_id: id, document_id: document, position: ko, base_revision: base, device_id: 'proof-installation-device-A', observed_at: '2026-01-01T00:00:00Z', fraction: 0.2 } }),
      activity: (document, id, duration = 30) => ({ kind: 'activity', payload: { event_id: id, document_id: document, device_id: 'proof-installation-device-A', start_time: '2026-01-01T00:00:00Z', duration, start_fraction: 0.1, end_fraction: 0.2 } }),
      receipt: (id, kind = 'progress', revision = kind === 'progress' ? '1' : null) => ({ event_id: id, kind, revision })
    };
  });
}
