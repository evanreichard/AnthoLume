import type { components } from './schema.gen';
import {
  checkListShelfmarkRequests200,
  checkSearchShelfmark200,
  checkShelfmarkBook,
  checkShelfmarkSettings,
} from './guards.gen.js';

export type ShelfmarkBook = components['schemas']['ShelfmarkBook'];
export type ShelfmarkRequestInfo = components['schemas']['ShelfmarkRequestInfo'];
type ShelfmarkSettings = components['schemas']['ShelfmarkSettings'];

export function isShelfmarkSettings(value: unknown): value is ShelfmarkSettings {
  return checkShelfmarkSettings(value) && (!value.enabled || value.configured);
}

function hasValidRequest(book: ShelfmarkBook): book is ShelfmarkBook & { request: ShelfmarkRequestInfo } {
  return book.request !== undefined && Number.isFinite(Date.parse(book.request.requested_at));
}

export function isRequestedShelfmarkBook(value: unknown): value is ShelfmarkBook & { request: ShelfmarkRequestInfo } {
  return checkShelfmarkBook(value) && hasValidRequest(value);
}

export function isShelfmarkSearch(value: unknown): value is ShelfmarkBook[] {
  return checkSearchShelfmark200(value) && value.every((book) => book.request === undefined || hasValidRequest(book));
}

export function isShelfmarkHistory(value: unknown): value is (ShelfmarkBook & { request: ShelfmarkRequestInfo })[] {
  return checkListShelfmarkRequests200(value) && value.every(hasValidRequest);
}
