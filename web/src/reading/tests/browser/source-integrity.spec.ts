import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { aliceFixture } from '../alice-fixture';
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!window.readingTest); });
test('real source worker matches original Alice KO vector while legacy full-MD5 server identity remains opaque in stored events', async ({ page }) => {
  const sha256 = createHash('sha256').update(readFileSync(aliceFixture)).digest('hex');
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`alice-identity-${crypto.randomUUID()}`)), account = { origin: location.origin, userId: 'old-reader' }, ref = { kind: 'server' as const, account, documentId: '0f36c66155de34b281c4791654d0b1ce' }, file = await (await fetch('/fixtures/alice.epub')).blob(); await repo.setAccess({ kind: 'authenticated', account }); await repo.install(ref, file, null, null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
    const opened = await repo.open(ref), checkpoint = { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 }; await p.accountTurn(repo, ref, checkpoint); const event = (await repo.pending())[0]!; const out = { serverID: opened.row.ref.kind === 'server' && opened.row.ref.documentId, eventID: event.payload.document_id, protocolHash: opened.row.protocolHash, checksum: opened.row.checksum, checkpoint: (await repo.open(ref)).row.checkpoint }; await repo.db.delete(); return out;
  });
  expect(result).toEqual({ serverID: '0f36c66155de34b281c4791654d0b1ce', eventID: '0f36c66155de34b281c4791654d0b1ce', protocolHash: '386d1cb51fe4a72e5c9fdad5e059bad9', checksum: sha256, checkpoint: { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 } });
});
// Upstream Oracle - Byte samples from https://github.com/koreader/koreader/blob/6e40ca6b1443996ab9b04fbb19173b563b2921dd/frontend/util.lua#L1094-L1111 with a byte-collecting digest sink.
const partialVectors = [
  [1, '93b885adfe0da089cdf634904fd59f71'],
  [1023, 'a4251fab5005302261eac84375ef8442'],
  [1024, '19fa36fd104d1b15e6e46b88444a9e73'],
  [1025, '2e5f71dc221b0ae96c5dc92c72c9245e'],
  [2000, 'd4ba131cde1291871f9fbab90b4bb80b'],
  [4095, '8119cf688ab6667c062155ed2db805f3'],
  [4096, '8119cf688ab6667c062155ed2db805f3'],
  [4097, '6eb50ffd1fa15a300c6983d11d35ada5'],
  [5000, '35eb34ba0a1465659262342ec88014c5'],
  [10000, '9884fcffb148c77e94a49c7af05982d2'],
  [16383, '9884fcffb148c77e94a49c7af05982d2'],
  [16384, '9884fcffb148c77e94a49c7af05982d2'],
  [16385, 'd98dee5d9ad498705789c4f15df578b2'],
  [262145, '45980c72b809c69ddbe99918955a880b'],
] as const;
for (const [size, protocolHash] of partialVectors) {
  test(`real source worker hashes up to 1024 bytes per KOReader offset: ${size} bytes`, async ({ page }) => {
    const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + Math.floor(i / 251)) % 256);
    const result = await page.evaluate(async size => {
      const p = window.readingTest, bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + Math.floor(i / 251)) % 256);
      return p.hashSource(p.blobSource(new Blob([bytes])));
    }, size);
    const digests = [];
    for (let offset = 0; offset < size; offset += 262144) digests.push(createHash('sha256').update(bytes.subarray(offset, offset + 262144)).digest('hex'));
    expect(result.protocolHash).toBe(protocolHash);
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.digests).toEqual(digests);
  });
}
test('real source worker keeps full SHA-256 integrity separate from unsampled KOReader identity', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, hash = (bytes: Uint8Array<ArrayBuffer>) => p.hashSource(p.blobSource(new Blob([bytes]))), a = new Uint8Array(10000), b = a.slice(); b[9000] = 1;
    return { first: await hash(a), second: await hash(b) };
  });
  const a = new Uint8Array(10000), b = a.slice(); b[9000] = 1;
  expect(result.first.protocolHash).toBe('d2a70550489de356a2cd6bfc40711204');
  expect(result.second.protocolHash).toBe(result.first.protocolHash);
  expect(result.first.sha256).toBe(createHash('sha256').update(a).digest('hex'));
  expect(result.second.sha256).toBe(createHash('sha256').update(b).digest('hex'));
  expect(result.second.sha256).not.toBe(result.first.sha256);
});
