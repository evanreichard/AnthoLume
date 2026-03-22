export type ThemeMode = 'light' | 'dark' | 'system';
export type DocumentsViewMode = 'grid' | 'list';

const LOCAL_SETTINGS_KEY = 'antholume:settings';

interface LocalSettings {
  themeMode?: ThemeMode;
  documentsViewMode?: DocumentsViewMode;
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readLocalSettings(): LocalSettings {
  if (!canUseLocalStorage()) {
    return {};
  }

  const rawValue = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    return typeof parsedValue === 'object' && parsedValue !== null ? parsedValue : {};
  } catch {
    return {};
  }
}

function writeLocalSettings(settings: LocalSettings): void {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
}

function updateLocalSettings(partialSettings: LocalSettings): void {
  writeLocalSettings({
    ...readLocalSettings(),
    ...partialSettings,
  });
}

export function getThemeMode(): ThemeMode {
  const settings = readLocalSettings();
  return settings.themeMode === 'light' || settings.themeMode === 'dark'
    ? settings.themeMode
    : 'system';
}

export function setThemeMode(themeMode: ThemeMode): void {
  updateLocalSettings({ themeMode });
}

export function getDocumentsViewMode(): DocumentsViewMode {
  const settings = readLocalSettings();
  return settings.documentsViewMode === 'list' ? 'list' : 'grid';
}

export function setDocumentsViewMode(documentsViewMode: DocumentsViewMode): void {
  updateLocalSettings({ documentsViewMode });
}
