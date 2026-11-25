import { queryOptions } from '@tanstack/react-query';
import type { components } from './api/schema.gen';
import type { Account } from './reading';
import { session } from './session';

type JobKind = components['schemas']['AdminJob']['kind'];

export const storageRootsKey = (account: Account) => ['admin-storage-roots', account] as const;
export const adminJobsKey = (account: Account, kind: JobKind) => ['admin-jobs', account, kind] as const;
export const backupPreviewKey = (account: Account) => ['admin-backup-preview', account] as const;
export const autoImportRulesKey = (account: Account) => ['auto-import-rules', account] as const;

export function storageRootsOptions(account: Account) {
  return queryOptions({ queryKey: storageRootsKey(account), queryFn: ({ signal }) => session.api.adminStorageRoots(account, signal) });
}

export function adminJobsOptions(account: Account, kind: JobKind) {
  return queryOptions({ queryKey: adminJobsKey(account, kind), queryFn: ({ signal }) => session.api.adminJobs(account, kind, signal) });
}
