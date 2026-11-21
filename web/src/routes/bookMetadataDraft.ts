import type { components } from '../api/schema.gen';

export function bookMetadataDraft(book: components['schemas']['Document']) {
  return { title: book.title ?? '', author: book.author ?? '', description: book.description ?? '', isbn10: book.isbn10 ?? '', isbn13: book.isbn13 ?? '' };
}

export async function encodeBookCover(cover: Blob) {
  const bytes = new Uint8Array(await cover.arrayBuffer());
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(''));
}
