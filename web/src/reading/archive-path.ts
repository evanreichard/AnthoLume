export type ArchiveReference = { path: string; fragment: string };
export function archiveReference(value: string, entry: string): ArchiveReference {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value) || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error('Non-archive resource URL');
  const parts = value.split('#');
  if (parts.length > 2 || parts[0]!.includes('?')) throw new Error('Unsupported archive URL');
  if (/%(?:2f|5c|00)/i.test(parts[0]!)) throw new Error('Encoded path separator/control');
  const relative = decodeURIComponent(parts[0]!);
  if (/[\\\u0000-\u0020\u007f?#]/.test(relative) || /%[0-9a-f]{2}/i.test(relative)) throw new Error('Ambiguous archive URL encoding');
  const stack = entry.split('/').slice(0, -1);
  if (relative) for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!stack.length) throw new Error('Resource escapes archive'); stack.pop(); }
    else stack.push(part);
  }
  return { path: relative ? stack.join('/') : entry, fragment: decodeURIComponent(parts[1] || '') };
}
