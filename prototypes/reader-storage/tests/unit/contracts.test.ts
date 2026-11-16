import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { partialMD5, fullMD5 } from '../../src/identity';
import { parseKO } from '../../src/codec';
import { measureActivity } from '../../src/activity';
import { ProgressTransportFake, ReceiptTransportFake } from '../../src/transport-fake';
import type { ReadingEvent } from '../../src/storage';

describe('protocol identity and KO position grammar', () => {
  test('Alice bytes retain both existing server hash vectors', () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../public/fixtures/alice.epub', import.meta.url))).buffer;
    expect(partialMD5(bytes)).toBe('386d1cb51fe4a72e5c9fdad5e059bad9');
    expect(fullMD5(bytes)).toBe('0f36c66155de34b281c4791654d0b1ce');
  });
  test('complete samples only, not a new full-file identity', () => {
    expect(partialMD5(new ArrayBuffer(1023))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(partialMD5(new ArrayBuffer(1024))).toBe('0f343b0931126a20f133d67c2b018a3b');
    expect(partialMD5(new ArrayBuffer(2047))).toBe(partialMD5(new ArrayBuffer(1024)));
    expect(partialMD5(new ArrayBuffer(2048))).not.toBe(partialMD5(new ArrayBuffer(1024)));
    const a = new Uint8Array(10000); const b = a.slice(); b[9000] = 1;
    expect(partialMD5(a.buffer)).toBe(partialMD5(b.buffer));
    expect(fullMD5(a.buffer)).not.toBe(fullMD5(b.buffer));
  });
  test('KO element precision accepts legacy suffixes, rejects selector injection', () => {
    expect(parseKO('/body/DocFragment[19]/body/h1/img.0')).toEqual({ spine: 18, steps: [{ tag: 'h1', index: 1 }, { tag: 'img', index: 1 }] });
    expect(parseKO('/body/DocFragment[1]/body/p[2]/text()[1].23').steps).toEqual([{ tag: 'p', index: 2 }]);
    for (const path of ['', 'epubcfi(/6/2!/4)', '/body/DocFragment[0]/body', '/body/DocFragment[1]/body/p,script', '/body/DocFragment[1]/body/p[0]']) expect(() => parseKO(path)).toThrow();
  });
});
describe('unchanged forward-turn/WPM policy', () => {
  const input = { forward: true, localOnly: false, pageWords: 100, totalWords: 10000, currentWord: 500, pageStartMs: 100000, nowMs: 130000 };
  test('forward credit retains page rounding, epoch seconds and elapsed duration', () => expect(measureActivity(input)).toEqual({ duration: 30, start_time: 100, page: 5, pages: 100 }));
  test('>=2000 WPM excluded; below 100 WPM capped', () => {
    expect(measureActivity({ ...input, nowMs: 103000 })).toBeUndefined();
    expect(measureActivity({ ...input, nowMs: 300000 })?.duration).toBe(60);
  });
  test('no backward, local-only, zero-word, invalid or instantaneous credit', () => {
    expect(measureActivity({ ...input, forward: false })).toBeUndefined();
    expect(measureActivity({ ...input, localOnly: true })).toBeUndefined();
    expect(measureActivity({ ...input, pageWords: 0 })).toBeUndefined();
    expect(measureActivity({ ...input, totalWords: NaN })).toBeUndefined();
    expect(measureActivity({ ...input, nowMs: input.pageStartMs })).toBeUndefined();
  });
});
describe('explicit revision choice and deterministic receipt fake', () => {
  test('stale lower fraction waits; explicit local choice moves backward; repeated stale choice cannot overwrite advanced head', () => {
    const transport = new ProgressTransportFake();
    expect(transport.read().revision).toBe('0');
    transport.propose({ ko: 'server', fraction: 0.8 }, '0');
    const conflict = transport.propose({ ko: 'local', fraction: 0.2 }, '0');
    expect(conflict.state).toBe('choice-required');
    expect(transport.read().fraction).toBe(0.8);
    if (conflict.state !== 'choice-required') throw new Error('Expected conflict');
    expect(transport.choose('local', conflict).state).toBe('committed');
    expect(transport.read().fraction).toBe(0.2);
    expect(transport.choose('local', conflict).state).toBe('choice-required');
    expect(transport.choose('server', conflict).server).toEqual(transport.read());
  });
  test('higher stale local fraction also requires choice; server choice does not publish it', () => {
    const transport = new ProgressTransportFake();
    transport.propose({ ko: 'server', fraction: 0.8 }, '0');
    const conflict = transport.propose({ ko: 'farther-but-stale', fraction: 0.99 }, '0');
    expect(conflict.state).toBe('choice-required');
    if (conflict.state !== 'choice-required') throw new Error('Expected conflict');
    expect(transport.choose('server', conflict).server.fraction).toBe(0.8);
    expect(transport.read().revision).toBe('1');
  });
  test('lost response retries exact immutable event; changed payload conflicts; legitimate same activity with new ID credits', () => {
    const fake = new ReceiptTransportFake();
    const event: ReadingEvent = { id: 'one', scope: 'remote:A', document: 'unchanged-server-id', sequence: 1, kind: 'activity', schema: 2, payload: { event_id: 'one', document_id: 'unchanged-server-id', device_id: 'device-A', start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: 0.1, end_fraction: 0.2 } };
    fake.dropNextResponse = true;
    expect(() => fake.send(event.scope, [event])).toThrow('Response lost');
    expect(fake.send(event.scope, [event]).status).toBe(200);
    expect(fake.creditedSeconds).toBe(30);
    expect(fake.send(event.scope, [{ ...event, payload: { ...event.payload, duration: 60 } }]).status).toBe(409);
    fake.send(event.scope, [{ ...event, id: 'two', payload: { ...event.payload, event_id: 'two' } }]);
    expect(fake.creditedSeconds).toBe(60);
  });
});
