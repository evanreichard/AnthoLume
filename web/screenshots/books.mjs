import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';

const exec = promisify(execFile);

const editions = [
  [11, "Alice's Adventures in Wonderland", 'Lewis Carroll', '8920c32185106b53e7a87c101b7908193ce1ad00048ee77e0aa60f2fa2dbf4ae'],
  [1661, 'The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', '1fdda8199d16c4408ceed245cf754c1813a00e2484c0f308cecd754e1e57c244'],
  [84, 'Frankenstein', 'Mary Shelley', 'b6e688812023020349c0ea0810d1932709c56ce8d34a53cc966922da445ddcd1'],
  [35, 'The Time Machine', 'H. G. Wells', 'f52cfd0c629d87db3ef91ced77ef5fd7e8fc8f3a997c73aede05e67091d14eec'],
  [174, 'The Picture of Dorian Gray', 'Oscar Wilde', '47859c23d11ca612b38f1823c887e8ae96368efd12101d755c734c5c8cf0de65'],
  [43, 'Dr. Jekyll and Mr. Hyde', 'Robert Louis Stevenson', '0bf449baafba3d997d97c434de1c2321942d9f719837d4f374784c41b98edce7'],
];

const cache = 'build/screenshot-books';
export async function* books({ signal } = {}) {
  await mkdir(cache, { recursive: true });
  for (const [id, title, author, sha] of editions) {
    const path = join(cache, id + '.epub');
    let bytes;
    try { bytes = await readFile(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const cached = !!bytes;
    bytes ??= (await exec('curl', ['--fail', '--silent', '--show-error', '--location', '--retry', '2', '--max-time', '90',
      `https://gutenberg.pglaf.org/cache/epub/${id}/pg${id}-images-3.epub`], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, signal })).stdout;
    if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error(`Checksum mismatch for ${title} (${cached ? path : 'upstream EPUB'}). Review the edition before changing its pin.`);
    if (!cached) {
      const tmp = path + '.' + process.pid;
      try { await writeFile(tmp, bytes); await rename(tmp, path); } finally { await rm(tmp, { force: true }); }
    }
    const zip = await JSZip.loadAsync(bytes);
    const [cover] = zip.file(/cover\.jpg$/i);
    if (!cover) throw new Error(`Missing cover for ${title}`);
    yield { title, author, bytes, cover: await cover.async('base64') };
  }
}
