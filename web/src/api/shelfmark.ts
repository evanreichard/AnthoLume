import type { components } from './schema.gen';
import {
  checkListShelfmarkRequestedReleases200,
  checkListShelfmarkRequests200,
  checkSearchShelfmark200,
  checkShelfmarkDownloadResult,
  checkShelfmarkReleaseList,
  checkShelfmarkSettings,
} from './guards.gen.js';

export type ShelfmarkBook = components['schemas']['ShelfmarkBook'];
export type ShelfmarkRelease = components['schemas']['ShelfmarkRelease'];
export type ShelfmarkReleases = components['schemas']['ShelfmarkReleaseList'];
type ShelfmarkSettings = components['schemas']['ShelfmarkSettings'];

export function isShelfmarkSettings(value: unknown): value is ShelfmarkSettings {
  return checkShelfmarkSettings(value) && (!value.enabled || value.configured);
}

export const isShelfmarkSearch = checkSearchShelfmark200;
export const isShelfmarkHistory = checkListShelfmarkRequests200;
export function isShelfmarkReleases(value: unknown): value is ShelfmarkReleases {
  return checkShelfmarkReleaseList(value) && value.releases.every((row) => !!row.request || !!row.selection);
}

export function isShelfmarkDownloadResult(value: unknown): value is {
  release: ShelfmarkRelease & { request: NonNullable<ShelfmarkRelease['request']> };
  request_count: number;
} {
  return checkShelfmarkDownloadResult(value) && value.release.request !== undefined;
}

export function isShelfmarkReleaseHistory(value: unknown): value is ShelfmarkRelease[] {
  return checkListShelfmarkRequestedReleases200(value) && value.every((release) => release.request !== undefined);
}
