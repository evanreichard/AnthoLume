import { expect, test } from 'vitest';
import { receiptFor, validSubmission, type ProgressEvent } from '../../src/wire';
import { ReceiptTransportFake } from '../../src/transport-fake';
import type { ReadingEvent } from '../../src/storage';

const payload: ProgressEvent = { event_id: 'progress-one', document_id: 'book', device_id: 'installation-device-A', base_revision: '0', position: '/body/DocFragment[1]/body/p[1]', fraction: 0.2, observed_at: '2026-01-01T00:00:00Z' };
const event: ReadingEvent = { id: payload.event_id, scope: 'remote:A', document: 'book', sequence: 1, schema: 2, kind: 'progress', payload };

test('generated ProgressEvent shape requires opaque zero-based revision and identity/time/location fields', () => {
  expect(validSubmission(event)).toBe(true);
  expect(validSubmission({ ...event, payload: { ...payload, base_revision: '01' } })).toBe(false);
  expect(validSubmission({ ...event, payload: { ...payload, device_id: '' } })).toBe(false);
  expect(validSubmission({ ...event, payload: { ...payload, observed_at: 'invalid' } })).toBe(false);
  expect(validSubmission({ ...event, payload: { ...payload, fraction: NaN } })).toBe(false);
});

test('receipt revision stays an exact string beyond JS safe integers and binds to the submitted CAS revision', () => {
  const large = { ...event, payload: { ...payload, base_revision: '9007199254740992' } };
  expect(receiptFor({ event_id: payload.event_id, kind: 'progress', revision: '9007199254740993' }, large)).toBe(true);
  expect(receiptFor({ event_id: payload.event_id, kind: 'progress', revision: 9007199254740993 }, large)).toBe(false);
  expect(receiptFor({ event_id: payload.event_id, kind: 'progress', revision: '9007199254740992' }, large)).toBe(false);
});

test('CAS receipt retry precedes conflict even after the shared fake head advances', () => {
  const fake = new ReceiptTransportFake();
  expect(fake.progress(event.scope, event.document).read().revision).toBe('0');
  fake.dropNextResponse = true;
  expect(() => fake.send(event.scope, [event])).toThrow('Response lost');
  fake.progress(event.scope, event.document).propose({ ko: 'other-device', fraction: 0.9 }, '1');
  expect(fake.send(event.scope, [event])).toEqual({ status: 200, scope: event.scope, receipts: [{ event_id: payload.event_id, kind: 'progress', revision: '1' }] });
  const stale = { ...event, id: 'new-stale', payload: { ...payload, event_id: 'new-stale' } };
  expect(fake.send(event.scope, [stale])).toEqual({ status: 409, scope: event.scope, current_revision: '2' });
  expect(fake.progress(event.scope, event.document).read()).toEqual({ ko: 'other-device', fraction: 0.9, revision: '2' });
});
