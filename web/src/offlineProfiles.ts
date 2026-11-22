import { accountKey, type Account } from './reading/types';

export type OfflineProfile = { account: Account; name: string };
const prefix = 'antholume:offline-profile:';
const selection = 'antholume:offline-selection';
export function profiles(): OfflineProfile[] {
  try {
    return Object.keys(localStorage).filter(key => key.startsWith(prefix)).flatMap(key => {
      const p: OfflineProfile = JSON.parse(localStorage.getItem(key)!);
      return p?.account?.origin === location.origin && typeof p.name === 'string' && key === prefix + accountKey(p.account) ? [p] : [];
    }).sort((a,b) => a.name.localeCompare(b.name));
  } catch { return []; }
}
export function rememberProfile(account: Account, name: string) {
  localStorage.setItem(prefix + accountKey(account), JSON.stringify({ account, name }));
}
export function selectProfile(account: Account | null) {
  if (account) sessionStorage.setItem(selection, accountKey(account)); else sessionStorage.removeItem(selection);
}
export function selectedProfile() {
  return profiles().find(p => accountKey(p.account) === sessionStorage.getItem(selection))?.account;
}
export function forgetProfile(account: Account) { localStorage.removeItem(prefix + accountKey(account)); }
export function isProfileKey(key: string | null) { return key === null || key.startsWith(prefix); }
