export type ThemeMode = 'light' | 'dark' | 'system';
export type DocumentsViewMode = 'grid' | 'list';
export type ReaderColorScheme = 'light' | 'tan' | 'blue' | 'gray' | 'black';
export type ReaderFontFamily = 'Serif' | 'Open Sans' | 'Arbutus Slab' | 'Lato';

const LOCAL_SETTINGS_KEY = 'antholume:settings';

interface LocalSettings {
  themeMode?: ThemeMode;
  documentsViewMode?: DocumentsViewMode;
  readerColorScheme?: ReaderColorScheme;
  readerFontFamily?: ReaderFontFamily;
  readerFontSize?: number;
  readerDeviceId?: string;
  readerDeviceName?: string;
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

export function getReaderColorScheme(): ReaderColorScheme {
  const settings = readLocalSettings();
  switch (settings.readerColorScheme) {
    case 'light':
    case 'tan':
    case 'blue':
    case 'gray':
    case 'black':
      return settings.readerColorScheme;
    default:
      return 'tan';
  }
}

export function setReaderColorScheme(readerColorScheme: ReaderColorScheme): void {
  updateLocalSettings({ readerColorScheme });
}

export function getReaderFontFamily(): ReaderFontFamily {
  const settings = readLocalSettings();
  switch (settings.readerFontFamily) {
    case 'Serif':
    case 'Open Sans':
    case 'Arbutus Slab':
    case 'Lato':
      return settings.readerFontFamily;
    default:
      return 'Serif';
  }
}

export function setReaderFontFamily(readerFontFamily: ReaderFontFamily): void {
  updateLocalSettings({ readerFontFamily });
}

export function getReaderFontSize(): number {
  const settings = readLocalSettings();
  return typeof settings.readerFontSize === 'number' && settings.readerFontSize > 0
    ? settings.readerFontSize
    : 1;
}

export function setReaderFontSize(readerFontSize: number): void {
  updateLocalSettings({ readerFontSize });
}

export function getReaderDevice(): { id: string; name: string } {
  const settings = readLocalSettings();
  const id =
    typeof settings.readerDeviceId === 'string' && settings.readerDeviceId.length > 0
      ? settings.readerDeviceId
      : crypto.randomUUID();
  const name =
    typeof settings.readerDeviceName === 'string' && settings.readerDeviceName.length > 0
      ? settings.readerDeviceName
      : 'Web Reader';

  if (id !== settings.readerDeviceId || name !== settings.readerDeviceName) {
    updateLocalSettings({
      readerDeviceId: id,
      readerDeviceName: name,
    });
  }

  return { id, name };
}

export function setReaderDevice(name: string, id?: string): void {
  updateLocalSettings({
    readerDeviceId: id ?? crypto.randomUUID(),
    readerDeviceName: name,
  });
}
