const table = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export function crc32(bytes: Uint8Array, previous = 0): number { let n = previous ^ 0xffffffff; for (const byte of bytes) n = table[(n ^ byte) & 255]! ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
export function validZipFlags(method: number, flags: number): boolean { return (method === 0 || method === 8) && !(flags & ~(method === 8 ? 0x080e : 0x0808)); }
