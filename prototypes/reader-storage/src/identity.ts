import SparkMD5 from 'spark-md5';

// Protocol Identity - Match Go's complete 1024-byte samples, including its short-tail behavior.
export function partialMD5(bytes: ArrayBuffer): string {
  const hash = new SparkMD5.ArrayBuffer();
  for (let i = -1; i <= 10; i++) {
    const offset = i === -1 ? 0 : 1024 * 2 ** (2 * i);
    if (offset + 1024 > bytes.byteLength) break;
    hash.append(bytes.slice(offset, offset + 1024));
  }
  return hash.end();
}
export function fullMD5(bytes: ArrayBuffer): string { return SparkMD5.ArrayBuffer.hash(bytes); }
