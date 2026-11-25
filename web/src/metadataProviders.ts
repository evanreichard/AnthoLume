import { queryOptions } from '@tanstack/react-query';
import type { Account } from './reading';
import { session } from './session';

export function metadataProviderOptions(account: Account) {
  return queryOptions({
    queryKey: ['metadata-providers', account],
    queryFn: ({ signal }) => session.api.metadataProviders(account, signal),
  });
}
