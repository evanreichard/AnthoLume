export const mediaLimits = { dimension: 8192, pixels: 8 * 1024 * 1024, totalPixels: 32 * 1024 * 1024 } as const;
function requireImage(ok: unknown): asserts ok { if (!ok) throw new Error('Unsupported image header, animation or decoded-pixel budget'); }
export function rasterDimensions(media: string, bytes: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number, little = false) => { requireImage(p >= 0 && p + 2 <= bytes.length); return v.getUint16(p, little); };
  const u32 = (p: number, little = false) => { requireImage(p >= 0 && p + 4 <= bytes.length); return v.getUint32(p, little); };
  const label = (p: number) => String.fromCharCode(...bytes.subarray(p, p + 4));
  let width = 0, height = 0;
  if (media === 'image/png') {
    requireImage(u32(8) === 13 && label(12) === 'IHDR'); width = u32(16); height = u32(20);
    for (let p = 8; p < bytes.length;) { const size = u32(p); requireImage(p + size + 12 <= bytes.length); if (label(p + 4) === 'acTL') requireImage(false); p += size + 12; }
  } else if (media === 'image/jpeg') {
    let p = 2;
    while (p < bytes.length) {
      requireImage(bytes[p++] === 255); while (bytes[p] === 255) p++;
      const marker = bytes[p++]; if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker !== undefined && marker >= 0xd0 && marker <= 0xd7) continue;
      const size = u16(p); requireImage(size >= 2 && p + size <= bytes.length);
      if (marker !== undefined && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) { requireImage(size >= 8); height = u16(p + 3); width = u16(p + 5); break; }
      p += size;
    }
  } else if (media === 'image/gif') {
    width = u16(6, true); height = u16(8, true); requireImage(bytes.length >= 13);
    let p = 13 + (bytes[10]! & 128 ? 3 * 2 ** ((bytes[10]! & 7) + 1) : 0), frames = 0;
    const blocks = () => { for (;;) { requireImage(p < bytes.length); const size = bytes[p++]!; if (!size) return; requireImage(p + size <= bytes.length); p += size; } };
    while (p < bytes.length) {
      const marker = bytes[p++]; if (marker === 0x3b) break;
      if (marker === 0x21) { requireImage(p < bytes.length); p++; blocks(); }
      else if (marker === 0x2c) { requireImage(++frames === 1 && p + 9 <= bytes.length && u16(p + 4, true) > 0 && u16(p + 6, true) > 0 && u16(p, true) + u16(p + 4, true) <= width && u16(p + 2, true) + u16(p + 6, true) <= height); const packed = bytes[p + 8]!; p += 9 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0); requireImage(p < bytes.length); p++; blocks(); }
      else requireImage(false);
    }
    requireImage(frames === 1);
  } else if (media === 'image/webp') {
    requireImage(u32(4, true) + 8 === bytes.length); let frames = 0;
    for (let p = 12; p < bytes.length;) {
      const name = label(p), size = u32(p + 4, true), data = p + 8; requireImage(data + size <= bytes.length);
      if (name === 'ANIM' || name === 'ANMF') requireImage(false);
      if (name === 'VP8X') requireImage(size >= 10 && !(bytes[data]! & 2));
      if (name === 'VP8 ') { requireImage(++frames === 1 && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 1 && bytes[data + 5] === 0x2a); width = u16(data + 6, true) & 0x3fff; height = u16(data + 8, true) & 0x3fff; }
      if (name === 'VP8L') { requireImage(++frames === 1 && size >= 5 && bytes[data] === 0x2f); const bits = u32(data + 1, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
      p = data + size + (size & 1);
    }
  } else return null;
  requireImage(width > 0 && height > 0 && width <= mediaLimits.dimension && height <= mediaLimits.dimension && width * height <= mediaLimits.pixels);
  return { width, height };
}
