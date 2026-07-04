import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SettingsIcon, GitIcon } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { useGetInfo } from '../generated/anthoLumeAPIV1';
import { navItems, adminNavItems } from './navigation';
import { cn } from '../utils/cn';

function hasPrefix(path: string, prefix: string): boolean {
  return path.startsWith(prefix);
}

function NavToggleIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <span className="relative block size-7" aria-hidden="true">
      <span
        className={cn(
          'absolute left-0 top-1 h-0.5 w-7 bg-content transition-transform duration-200',
          isOpen && 'translate-y-2 rotate-45'
        )}
      />
      <span
        className={cn(
          'absolute left-0 top-3 h-0.5 w-7 bg-content transition-opacity duration-200',
          isOpen && 'opacity-0'
        )}
      />
      <span
        className={cn(
          'absolute left-0 top-5 h-0.5 w-7 bg-content transition-transform duration-200',
          isOpen && '-translate-y-2 -rotate-45'
        )}
      />
    </span>
  );
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
  const version = infoData?.version ?? 'v1.0.0';
  const closeMenu = () => setIsOpen(false);

  return (
    <div className="relative z-40 ml-6 flex flex-col">
      <button
        type="button"
        className="relative z-50 flex size-8 items-center justify-center lg:hidden"
        aria-label="Toggle navigation"
        aria-expanded={isOpen}
        aria-controls="mobile-navigation"
        onClick={() => setIsOpen(open => !open)}
      >
        <NavToggleIcon isOpen={isOpen} />
      </button>

      <div
        id="mobile-navigation"
        className={cn(
          'fixed -ml-6 h-full w-56 bg-surface shadow-lg transition-transform duration-200 lg:w-48 lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ top: 0, paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex h-16 justify-end lg:justify-around">
          <p className="my-auto pr-8 text-right text-xl font-bold text-content lg:pr-0">
            AnthoLume
          </p>
        </div>
        <nav>
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              onClick={closeMenu}
              className={cn(
                'my-2 flex w-full items-center justify-start border-l-4 p-2 pl-6 transition-colors duration-200',
                location.pathname === item.path
                  ? 'border-primary-500 text-content'
                  : 'border-transparent text-content-subtle hover:text-content'
              )}
            >
              <item.icon size={20} />
              <span className="mx-4 text-sm font-normal">{item.label}</span>
            </Link>
          ))}

          {isAdmin && (
            <div
              className={cn(
                'my-2 flex flex-col gap-4 border-l-4 p-2 pl-6 transition-colors duration-200',
                hasPrefix(location.pathname, '/admin')
                  ? 'border-primary-500 text-content'
                  : 'border-transparent text-content-subtle'
              )}
            >
              <Link
                to="/admin"
                onClick={closeMenu}
                className={cn(
                  'flex w-full justify-start',
                  location.pathname === '/admin' && !hasPrefix(location.pathname, '/admin/')
                    ? 'text-content'
                    : 'text-content-subtle hover:text-content'
                )}
              >
                <SettingsIcon size={20} />
                <span className="mx-4 text-sm font-normal">Admin</span>
              </Link>

              {hasPrefix(location.pathname, '/admin') && (
                <div className="flex flex-col gap-4">
                  {adminNavItems.map(item => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={closeMenu}
                      className={cn(
                        'flex w-full justify-start pl-7',
                        location.pathname === item.path
                          ? 'text-content'
                          : 'text-content-subtle hover:text-content'
                      )}
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
