import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HomeIcon, DocumentsIcon, ActivityIcon, SearchIcon, SettingsIcon, GitIcon } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { useGetInfo } from '../generated/anthoLumeAPIV1';

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  title: string;
}

const navItems: NavItem[] = [
  { path: '/', label: 'Home', icon: HomeIcon, title: 'Home' },
  { path: '/documents', label: 'Documents', icon: DocumentsIcon, title: 'Documents' },
  { path: '/progress', label: 'Progress', icon: ActivityIcon, title: 'Progress' },
  { path: '/activity', label: 'Activity', icon: ActivityIcon, title: 'Activity' },
  { path: '/search', label: 'Search', icon: SearchIcon, title: 'Search' },
];

const adminSubItems: NavItem[] = [
  { path: '/admin', label: 'General', icon: SettingsIcon, title: 'General' },
  { path: '/admin/import', label: 'Import', icon: SettingsIcon, title: 'Import' },
  { path: '/admin/users', label: 'Users', icon: SettingsIcon, title: 'Users' },
  { path: '/admin/logs', label: 'Logs', icon: SettingsIcon, title: 'Logs' },
];

function hasPrefix(path: string, prefix: string): boolean {
  return path.startsWith(prefix);
}

export default function HamburgerMenu() {
  const location = useLocation();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const isAdmin = user?.is_admin ?? false;

  const { data: infoData } = useGetInfo({
    query: {
      staleTime: Infinity,
    },
  });
  const version =
    infoData && 'data' in infoData && infoData.data && 'version' in infoData.data
      ? infoData.data.version
      : 'v1.0.0';

  return (
    <div className="relative z-40 ml-6 flex flex-col">
      <input
        type="checkbox"
        className="absolute -top-2 z-50 flex size-7 cursor-pointer opacity-0 lg:hidden"
        id="mobile-nav-checkbox"
        checked={isOpen}
        onChange={e => setIsOpen(e.target.checked)}
      />

      <span
        className="z-40 mt-0.5 h-0.5 w-7 bg-content transition-opacity duration-500 lg:hidden"
        style={{
          transformOrigin: '5px 0px',
          transition:
            'transform 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), background 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), opacity 0.55s ease',
          transform: isOpen ? 'rotate(45deg) translate(2px, -2px)' : 'none',
        }}
      />
      <span
        className="z-40 mt-1 h-0.5 w-7 bg-content transition-opacity duration-500 lg:hidden"
        style={{
          transformOrigin: '0% 100%',
          transition:
            'transform 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), background 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), opacity 0.55s ease',
          opacity: isOpen ? 0 : 1,
          transform: isOpen ? 'rotate(0deg) scale(0.2, 0.2)' : 'none',
        }}
      />
      <span
        className="z-40 mt-1 h-0.5 w-7 bg-content transition-opacity duration-500 lg:hidden"
        style={{
          transformOrigin: '0% 0%',
          transition:
            'transform 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), background 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), opacity 0.55s ease',
          transform: isOpen ? 'rotate(-45deg) translate(0, 6px)' : 'none',
        }}
      />

      <div
        id="menu"
        className="fixed -ml-6 h-full w-56 bg-surface shadow-lg lg:w-48"
        style={{
          top: 0,
          paddingTop: 'env(safe-area-inset-top)',
          transformOrigin: '0% 0%',
          transform: isOpen ? 'none' : 'translate(-100%, 0)',
          transition: 'transform 0.5s cubic-bezier(0.77, 0.2, 0.05, 1)',
        }}
      >
        <style>{`
          @media (min-width: 1024px) {
            #menu {
              transform: none !important;
            }
          }
        `}</style>
        <div className="flex h-16 justify-end lg:justify-around">
          <p className="my-auto pr-8 text-right text-xl font-bold text-content lg:pr-0">AnthoLume</p>
        </div>
        <nav>
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setIsOpen(false)}
              className={`my-2 flex w-full items-center justify-start border-l-4 p-2 pl-6 transition-colors duration-200 ${
                location.pathname === item.path
                  ? 'border-primary-500 text-content'
                  : 'border-transparent text-content-subtle hover:text-content'
              }`}
            >
              <item.icon size={20} />
              <span className="mx-4 text-sm font-normal">{item.label}</span>
            </Link>
          ))}

          {isAdmin && (
            <div
              className={`my-2 flex flex-col gap-4 border-l-4 p-2 pl-6 transition-colors duration-200 ${
                hasPrefix(location.pathname, '/admin')
                  ? 'border-primary-500 text-content'
                  : 'border-transparent text-content-subtle'
              }`}
            >
              <Link
                to="/admin"
                onClick={() => setIsOpen(false)}
                className={`flex w-full justify-start ${
                  location.pathname === '/admin' && !hasPrefix(location.pathname, '/admin/')
                    ? 'text-content'
                    : 'text-content-subtle hover:text-content'
                }`}
              >
                <SettingsIcon size={20} />
                <span className="mx-4 text-sm font-normal">Admin</span>
              </Link>

              {hasPrefix(location.pathname, '/admin') && (
                <div className="flex flex-col gap-4">
                  {adminSubItems.map(item => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsOpen(false)}
                      className={`flex w-full justify-start ${
                        location.pathname === item.path
                          ? 'text-content'
                          : 'text-content-subtle hover:text-content'
                      }`}
                      style={{ paddingLeft: '1.75em' }}
                    >
                      <span className="mx-4 text-sm font-normal">{item.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
        <a
          className="absolute bottom-0 flex w-full flex-col items-center justify-center gap-2 p-6 text-content"
          target="_blank"
          href="https://gitea.va.reichard.io/evan/AnthoLume"
          rel="noreferrer"
        >
          <GitIcon size={20} />
          <span className="text-xs">{version}</span>
        </a>
      </div>
    </div>
  );
}
