import { useCallback, useEffect, useState } from 'react';

// Value arrays are the single source of truth; the union types derive from them so the
// runtime iteration lists (reader theme picker, nav, etc.) and the schema can't drift.
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const DOCUMENTS_VIEW_MODES = ['grid', 'list'] as const;
export type DocumentsViewMode = (typeof DOCUMENTS_VIEW_MODES)[number];

export const READER_COLOR_SCHEMES = ['light', 'tan', 'blue', 'gray', 'black'] as const;
export type ReaderColorScheme = (typeof READER_COLOR_SCHEMES)[number];

export const READER_FONT_FAMILIES = ['Serif', 'Open Sans', 'Arbutus Slab', 'Lato'] as const;
export type ReaderFontFamily = (typeof READER_FONT_FAMILIES)[number];

export const LOCAL_SETTINGS_KEY = 'antholume:settings';

interface LocalSettingsMap {
  themeMode: ThemeMode;
  documentsViewMode: DocumentsViewMode;
  readerColorScheme: ReaderColorScheme;
  readerFontFamily: ReaderFontFamily;
  readerFontSize: number;
  readerDeviceId: string;
  readerDeviceName: string;
}

type LocalSettingKey = keyof LocalSettingsMap;

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readRawSettings(): Record<string, unknown> {
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

function writeRawSettings(settings: Record<string, unknown>): void {
  if (!canUseLocalStorage()) {
    return;
  }
  window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
}

function isValidValue(key: LocalSettingKey, value: unknown): boolean {
  switch (key) {
    case 'themeMode':
      return (THEME_MODES as readonly unknown[]).includes(value);
    case 'documentsViewMode':
      return (DOCUMENTS_VIEW_MODES as readonly unknown[]).includes(value);
    case 'readerColorScheme':
      return (READER_COLOR_SCHEMES as readonly unknown[]).includes(value);
    case 'readerFontFamily':
      return (READER_FONT_FAMILIES as readonly unknown[]).includes(value);
    case 'readerFontSize':
      return typeof value === 'number' && value > 0;
    case 'readerDeviceId':
    case 'readerDeviceName':
      return typeof value === 'string' && value.length > 0;
    default:
      return false;
  }
}

export function readLocalSetting<K extends LocalSettingKey>(
  key: K,
  defaultValue: LocalSettingsMap[K]
): LocalSettingsMap[K] {
  const value = readRawSettings()[key];
  return isValidValue(key, value) ? (value as LocalSettingsMap[K]) : defaultValue;
}

export function writeLocalSetting<K extends LocalSettingKey>(
  key: K,
  value: LocalSettingsMap[K]
): void {
  writeRawSettings({ ...readRawSettings(), [key]: value });
}

/**
 * Stateful accessor for a single localStorage-backed setting. Persists on change and re-reads
 * on cross-tab `storage` events. Validation rejects stale/invalid stored values in favor of
 * `defaultValue`, so callers never need their own get/set/validate pair.
 */
export function useLocalSetting<K extends LocalSettingKey>(
  key: K,
  defaultValue: LocalSettingsMap[K]
) {
  const [value, setValue] = useState<LocalSettingsMap[K]>(() =>
    readLocalSetting(key, defaultValue)
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== LOCAL_SETTINGS_KEY) {
        return;
      }
      setValue(readLocalSetting(key, defaultValue));
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [key, defaultValue]);

  const setValuePersisted = useCallback(
    (next: LocalSettingsMap[K]) => {
      writeLocalSetting(key, next);
      setValue(next);
    },
    [key]
  );

  return [value, setValuePersisted] as const;
}

// Reader Device - First-run UUID registration is a read side-effect that doesn't fit a value hook.
export function getReaderDevice(): { id: string; name: string } {
  const raw = readRawSettings();
  const id = isValidValue('readerDeviceId', raw.readerDeviceId)
    ? (raw.readerDeviceId as string)
    : crypto.randomUUID();
  const name = isValidValue('readerDeviceName', raw.readerDeviceName)
    ? (raw.readerDeviceName as string)
    : 'Web Reader';

  if (id !== raw.readerDeviceId || name !== raw.readerDeviceName) {
    writeLocalSetting('readerDeviceId', id);
    writeLocalSetting('readerDeviceName', name);
  }

  return { id, name };
}
