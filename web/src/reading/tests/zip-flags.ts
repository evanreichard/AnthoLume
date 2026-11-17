export function zipFlags(input: ArrayBuffer, options: number, utf8: boolean, targetMethod = 8, localOnly = false): ArrayBuffer {
  const bytes = input.slice(0), v = new DataView(bytes);
  let end = bytes.byteLength - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Test ZIP lacks an end record');
  let p = v.getUint32(end + 16, true);
  for (let n = 0; n < v.getUint16(end + 10, true); n++) {
    const method = v.getUint16(p + 10, true), local = v.getUint32(p + 42, true);
    const flags = (v.getUint16(p + 8, true) & 8) | (utf8 ? 0x800 : 0) | (method === targetMethod ? options : 0);
    v.setUint16(local + 6, flags, true); if (!localOnly) v.setUint16(p + 8, flags, true);
    p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return bytes;
}
