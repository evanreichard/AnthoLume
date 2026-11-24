import type { components } from './schema.gen';
import { checkDocumentPage, checkInsightActivityPage, checkInsightProgressPage, checkSession } from './guards.gen.js';

export {
  checkRevision as revision,
  checkCapabilities as isCapabilities,
  checkDocument as isDocument,
  checkDevice as isDevice,
  checkReadingState as isState,
  checkProblem as isProblem,
  checkMetadataMatch as isMetadataMatch,
  checkLookupMetadata200 as isMetadataMatches,
  checkManagedDevice as isManagedDevice,
  checkListManagedDevices200 as isManagedDevices,
  checkInsights as isInsights,
  checkInsightRankings as isInsightRankings,
  checkAdminJob as isAdminJob,
  checkListAdminJobs200 as isAdminJobs,
  checkAdminUser as isAdminUser,
  checkListAdminUsers200 as isAdminUsers,
  checkAdminSystem as isAdminSystem,
  checkAdminMetadataProvider as isAdminMetadataProvider,
  checkAdminRestore as isAdminRestore,
  checkAdminBackupPreview as isBackupPreview,
  checkListAdminAutoImports200 as isAdminAutoImport,
  checkMakeLibraryPlan as isMakeLibraryPlan,
  checkListAdminStorageRoots200 as isStorageRoots,
  checkAdminStorageDirectories as isStorageDirectories,
  checkAdminLogPage as isAdminLogs,
  checkPreviewAdminImport200 as isImportPreview,
  checkListAdminImportResults200 as isImportResults,
} from './guards.gen.js';

type S = components['schemas'];
export class InvalidResponse extends Error {
  constructor() { super('The server returned an invalid response. Nothing was acknowledged.'); }
}
export function isSession(value: unknown): value is S['Session'] {
  return checkSession(value) && (value.user === null) === (value.expires_at === null);
}
export function isPage(value: unknown): value is S['DocumentPage'] {
  return checkDocumentPage(value)
    && value.items.length <= Math.min(value.page_size, value.total)
    && new Set(value.items.map(item => item.id)).size === value.items.length
    && (value.next_page === null || value.next_page === value.page + 1);
}
export function isInsightActivity(value: unknown): value is S['InsightActivityPage'] {
  return checkInsightActivityPage(value) && value.has_more === (value.next_cursor !== undefined);
}
export function isInsightProgress(value: unknown): value is S['InsightProgressPage'] {
  return checkInsightProgressPage(value) && value.has_more === (value.next_cursor !== undefined);
}
export function validated<T>(value: unknown, guard: (value: unknown) => value is T): T {
  if (!guard(value)) throw new InvalidResponse();
  return value;
}
