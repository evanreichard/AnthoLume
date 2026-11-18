type Name = 'library' | 'insights' | 'settings' | 'back' | 'book' | 'download' | 'check' | 'cloud' | 'device' | 'external' | 'search' | 'add' | 'sort' | 'edit' | 'trash' | 'contents' | 'appearance' | 'user';

const paths: Record<Name, string> = {
  library: 'M4 5h4v14H4z M8 5h4v14H8z M14 6l3.5-1 4 13-3.5 1z',
  insights: 'M4 19h16 M7 15v-4 M12 15V6 M17 15V9',
  settings: 'M4 6h7m4 0h5 M4 12h3m4 0h9 M4 18h10m4 0h2 M11 4v4 M7 10v4 M14 16v4',
  back: 'm14 6-6 6 6 6',
  book: 'M12 6v14 M12 6C8 3 4 4 3 5v13c3-1 6-1 9 2 3-3 6-3 9-2V5c-1-1-5-2-9 1Z',
  download: 'M12 3v12m-4-4 4 4 4-4 M5 17v3h14v-3',
  check: 'm5 12 4 4L19 6',
  cloud: 'M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9a4.5 4.5 0 1 1 1.5 9Z',
  device: 'M6 4h12v16H6z M10 16h4',
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 20v-1a7 7 0 0 1 14 0v1',
  external: 'M9 5h10v10 M19 5 6 18',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z M16 16l4 4',
  add: 'M12 5v14 M5 12h14',
  edit: 'm14 6 4 4 M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 10v7m4-7v7',
  sort: 'M5 5h14 M5 10h10 M5 15h6 M18 10v9m-3-3 3 3 3-3',
  contents: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  appearance: 'm2 18 5-12 5 12 M4 14h6 M20 18v-5a3 3 0 0 0-6 0m6 1h-3.5a2 2 0 0 0 0 4H17a3 3 0 0 0 3-2',
};

export function Icon({ name, size = 20 }: { name: Name; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
