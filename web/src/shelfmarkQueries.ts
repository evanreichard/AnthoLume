import { useQuery } from '@tanstack/react-query';
import { session } from './session';
import type { Account } from './reading';

export const shelfmarkKey = (
  account: Account,
  kind: 'settings' | 'search' | 'history' | 'cover' | 'releases' | 'release-history',
) => ['shelfmark', account, kind] as const;

export function useShelfmarkSettings(account?: Account) {
  return useQuery({
    queryKey: account ? shelfmarkKey(account, 'settings') : ['shelfmark', 'signed-out'],
    enabled: !!account,
    queryFn: ({ signal }) => session.api.shelfmarkSettings(account!, signal),
  });
}
