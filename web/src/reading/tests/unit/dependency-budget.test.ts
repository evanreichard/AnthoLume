import { describe, expect, test } from 'vitest';
import { ChapterPolicy } from '../../chapter-policy';
import { ArchiveReader, blobSource } from '../../source';
import type { BookManifest } from '../../book-manifest';
describe('incremental dependency metadata', () => {
  test('duplicate references consume no new graph budget; unique edges stop before a book-sized graph accumulates', () => {
    const roles: [string, string][] = Array.from({ length: 10000 }, (_, n) => [`i${n}.png`, 'image/png']);
    const manifest: BookManifest = { version: 2, integrity: { sha256: '', protocolHash: '', digests: [] }, index: { entries: [], expanded: 0 }, opf: 'package.opf', spine: [], navigation: [], roles, documents: {}, dependencies: [], staticDependencies: [], images: {}, pixels: {}, title: null, author: null };
    const policy = new ChapterPolicy(new ArchiveReader(blobSource(new Blob(['x'])), manifest.index), manifest), entry = `${'c'.repeat(500)}.xhtml`;
    for (let i = 0; i < 20000; i++) policy.assetReference('i0.png', entry, 'image', false);
    expect(policy.dependencies.get(entry)!.size).toBe(1);
    let rejected = false;
    for (let i = 1; i < roles.length; i++) try { policy.assetReference(roles[i]![0], entry, 'image', false); } catch (error) { expect(String(error)).toContain('metadata budget'); rejected = true; break; }
    expect(rejected).toBe(true); expect(policy.dependencies.get(entry)!.size).toBeGreaterThan(1000); expect(policy.dependencies.get(entry)!.size).toBeLessThan(10000); policy.dispose();
  });
});
