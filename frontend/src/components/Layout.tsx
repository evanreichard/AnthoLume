import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { UserIcon, DropdownIcon } from '../icons';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeMode } from '../utils/localSettings';
import HamburgerMenu from './HamburgerMenu';
import { getPageTitle } from './navigation';

const themeModes: ThemeMode[] = ['light', 'dark', 'system'];

export default function Layout() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { themeMode, setThemeMode } = useTheme();
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    logout();
    setIsUserDropdownOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const currentPageTitle = getPageTitle(location.pathname);

  useEffect(() => {
    document.title = `AnthoLume - ${currentPageTitle}`;
  }, [currentPageTitle]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="flex h-16 w-full items-center justify-between">
        <HamburgerMenu />

        <h1 className="whitespace-nowrap px-6 text-xl font-bold text-content lg:ml-44">
          {currentPageTitle}
        </h1>

        <div
          className="relative flex w-full items-center justify-end space-x-4 p-4"
          ref={dropdownRef}
        >
          <button
            onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
            className="relative block text-content"
          >
            <UserIcon size={20} />
          </button>

          {isUserDropdownOpen && (
            <div className="absolute right-4 top-16 z-20 pt-4 transition duration-200">
              <div className="w-64 origin-top-right rounded-md bg-surface shadow-lg ring-1 ring-border/30">
                <div
                  className="border-b border-border px-4 py-3"
                  role="group"
                  aria-label="Theme mode"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-subtle">
                    Theme
                  </p>
                  <div className="inline-flex w-full rounded border border-border bg-surface-muted p-1">
                    {themeModes.map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setThemeMode(mode)}
                        className={`flex-1 rounded px-2 py-1 text-xs font-medium capitalize transition-colors ${
                          themeMode === mode
                            ? 'bg-content text-content-inverse'
                            : 'text-content-muted hover:bg-surface hover:text-content'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  className="py-1"
                  role="menu"
                  aria-orientation="vertical"
                  aria-labelledby="options-menu"
                >
                  <Link
                    to="/settings"
                    onClick={() => setIsUserDropdownOpen(false)}
                    className="block px-4 py-2 text-content-muted hover:bg-surface-muted hover:text-content"
                    role="menuitem"
                  >
                    <span className="flex flex-col">
                      <span>Settings</span>
                    </span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="block w-full px-4 py-2 text-left text-content-muted hover:bg-surface-muted hover:text-content"
                    role="menuitem"
                  >
                    <span className="flex flex-col">
                      <span>Logout</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
            className="flex cursor-pointer items-center gap-2 py-4 text-content-muted"
          >
            <span>{user?.username ?? 'User'}</span>
            <span
              className="text-content transition-transform duration-200"
              style={{ transform: isUserDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <DropdownIcon size={20} />
            </span>
          </button>
        </div>
      </div>

      <main
        className="relative overflow-hidden"
        style={{ height: 'calc(100dvh - 4rem - env(safe-area-inset-top))' }}
      >
        <div
          id="container"
          className="h-dvh overflow-auto px-4 md:px-6 lg:ml-48"
          style={{ paddingBottom: 'calc(5em + env(safe-area-inset-bottom) * 2)' }}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
