import type { ElementType } from 'react';
import { HomeIcon, DocumentsIcon, ActivityIcon, SearchIcon, ClockIcon } from '../icons';

export interface NavItem {
  path: string;
  label: string;
  icon: ElementType;
}

export const navItems: NavItem[] = [
  { path: '/', label: 'Home', icon: HomeIcon },
  { path: '/documents', label: 'Documents', icon: DocumentsIcon },
  { path: '/progress', label: 'Progress', icon: ClockIcon },
  { path: '/activity', label: 'Activity', icon: ActivityIcon },
  { path: '/search', label: 'Search', icon: SearchIcon },
];

export const adminNavItems: { path: string; label: string }[] = [
  { path: '/admin', label: 'General' },
  { path: '/admin/import', label: 'Import' },
  { path: '/admin/users', label: 'Users' },
  { path: '/admin/logs', label: 'Logs' },
];

// Ordered most-specific-first so prefix matching resolves nested routes correctly.
const pageTitles: { path: string; title: string }[] = [
  { path: '/admin/import-results', title: 'Admin - Import' },
  { path: '/admin/import', title: 'Admin - Import' },
  { path: '/admin/users', title: 'Admin - Users' },
  { path: '/admin/logs', title: 'Admin - Logs' },
  { path: '/admin', title: 'Admin - General' },
  { path: '/documents', title: 'Documents' },
  { path: '/progress', title: 'Progress' },
  { path: '/activity', title: 'Activity' },
  { path: '/search', title: 'Search' },
  { path: '/settings', title: 'Settings' },
  { path: '/', title: 'Home' },
];

export function getPageTitle(pathname: string): string {
  return (
    pageTitles.find(item =>
      item.path === '/' ? pathname === item.path : pathname.startsWith(item.path)
    )?.title ?? 'Home'
  );
}
