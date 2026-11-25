import { liveQuery } from 'dexie';
import { ReadingDB, profileKey } from './repository';
import { accountKey, type Account } from './types';

export type OfflineProfile = { account: Account; name: string };
const db = new ReadingDB();
const legacyPrefix = 'antholume:offline-profile:';

async function migrateProfiles() {
  await db.transaction('rw', db.meta, async () => {
    if (await db.meta.get('migrated:profiles')) return;
    let keys: string[];
    try {
      keys = Object.keys(localStorage);
    } catch {
      return;
    }
    for (const key of keys.filter((k) => k.startsWith(legacyPrefix))) {
      let p: OfflineProfile;
      try {
        p = JSON.parse(localStorage.getItem(key)!);
      } catch {
        continue;
      }
      if (
        p?.account?.origin === location.origin &&
        typeof p.name === 'string' &&
        key === legacyPrefix + accountKey(p.account)
      ) {
        await db.meta.put({ key: profileKey(p.account), value: p });
      }
    }
    await db.meta.put({ key: 'migrated:profiles', value: true });
  });
}
export async function watchProfiles(changed: (profiles: OfflineProfile[]) => void) {
  await migrateProfiles();
  return new Promise<void>((resolve, reject) => {
    liveQuery(() => db.meta.where('key').startsWith('profile:').toArray()).subscribe({
      next: (rows) => {
        changed(rows.map((row) => row.value as OfflineProfile).sort((a, b) => a.name.localeCompare(b.name)));
        resolve();
      },
      error: reject,
    });
  });
}
export function rememberProfile(account: Account, name: string) {
  return db.meta.put({ key: profileKey(account), value: { account, name } });
}
export async function forgetProfile(account: Account) {
  await db.transaction('rw', db.meta, db.offline, async () => {
    await db.meta.delete(profileKey(account));
    await db.offline.where('scope').equals(accountKey(account)).delete();
  });
  try {
    localStorage.removeItem(legacyPrefix + accountKey(account));
  } catch {
    /* IndexedDB owns the migrated profile. */
  }
}
const selection = 'antholume:offline-selection';
export function selectProfile(account?: Account) {
  try {
    if (account) sessionStorage.setItem(selection, accountKey(account));
    else sessionStorage.removeItem(selection);
  } catch {
    /* A tab-only selection is optional. */
  }
}
export function selectedProfile(profiles: OfflineProfile[]) {
  try {
    return profiles.find((p) => accountKey(p.account) === sessionStorage.getItem(selection))?.account;
  } catch {
    return undefined;
  }
}
