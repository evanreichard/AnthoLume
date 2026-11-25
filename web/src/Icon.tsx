export type IconName = 'close' | 'minus' | 'more' | 'kept' | 'down' | 'library' | 'insights' | 'settings' | 'back' | 'book' | 'download' | 'check' | 'cloud' | 'cloud-off' | 'device' | 'device-saved' | 'search' | 'add' | 'sort' | 'edit' | 'trash' | 'contents' | 'user' | 'warning' | 'folder' | 'up' | 'forward' | 'refresh' | 'sign-out' | 'upload' | 'info';

const device = 'M6 2.5h12A1.5 1.5 0 0 1 19.5 4v16a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5z M10.5 18.5h3';

const paths: Record<IconName, string> = {
  close: 'm6 6 12 12M18 6 6 18',
  more: 'M4 12h.1m7.9 0h.1m7.9 0h.1',
  kept: 'M15 20H5V3h13v8 M8 6h7 M10 17h1 m3-1 2.5 2.5L22 13',
  down: 'm6 9 6 6 6-6',
  library: 'M4 5h4v14H4z M8 5h4v14H8z M14 6l3.5-1 4 13-3.5 1z',
  insights: 'M4 19h16 M7 15v-4 M12 15V6 M17 15V9',
  settings: 'M4 6h7m4 0h5 M4 12h3m4 0h9 M4 18h10m4 0h2 M11 4v4 M7 10v4 M14 16v4',
  back: 'm14 6-6 6 6 6',
  forward: 'm10 6 6 6-6 6',
  up: 'M12 19V5m-6 6 6-6 6 6',
  book: 'M12 6v14 M12 6C8 3 4 4 3 5v13c3-1 6-1 9 2 3-3 6-3 9-2V5c-1-1-5-2-9 1Z',
  upload: 'M12 16V3m-4 4 4-4 4 4 M5 17v3h14v-3',
  info: 'M12 11v5m0-8v.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  minus: 'M5 12h14',
  download: 'M12 3v12m-4-4 4 4 4-4 M5 17v3h14v-3',
  check: 'm5 12 4 4L19 6',
  warning: 'M10.3 4.4a2 2 0 0 1 3.4 0l7.9 13.2a2 2 0 0 1-1.7 3H4.1a2 2 0 0 1-1.7-3z M12 9v4m0 3.5h.01',
  cloud: 'M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9a4.5 4.5 0 1 1 1.5 9Z',
  'cloud-off': 'm3 3 18 18 M7 7a6 6 0 0 0-1 3 4 4 0 0 0 1 8h11 M11 5a6 6 0 0 1 6 4 4.5 4.5 0 0 1 3.8 7',
  device,
  'device-saved': `${device} M8.5 10.5 11 13l4.8-5`,
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 20v-1a7 7 0 0 1 14 0v1',
  folder: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  'sign-out': 'M10 4H5v16h5m3-8h8m-4-4 4 4-4 4',
  refresh: 'M20 11a8 8 0 1 0-2 6m2-12v6h-6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z M16 16l4 4',
  add: 'M12 5v14 M5 12h14',
  edit: 'm14 6 4 4 M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 10v7m4-7v7',
  sort: 'M5 5h14 M5 10h10 M5 15h6 M18 10v9m-3-3 3 3 3-3',
  contents: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
