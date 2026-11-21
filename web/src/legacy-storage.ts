export function deleteLegacyIndexedDB() {
  // Best-Effort Cleanup - An old tab can hold the database open; don't wait before starting React.
  try {
    globalThis.indexedDB?.deleteDatabase('keyval-store');
  } catch {
    // IndexedDB access can be denied by browser privacy policies.
  }
}
