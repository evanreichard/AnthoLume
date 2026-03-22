import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, Outlet, Navigate } from 'react-router-dom';
import { useGetMe } from '../generated/anthoLumeAPIV1';
import { useAuth } from '../auth/AuthContext';
import { UserIcon } from '../icons';
import { ChevronDown } from 'lucide-react';
import HamburgerMenu from './HamburgerMenu';

export default function Layout() {
  const location = useLocation();
  const { isAuthenticated, user, logout, isCheckingAuth } = useAuth();
  const { data } = useGetMe(isAuthenticated ? {} : undefined);
  const userData = data?.data || user;
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    logout();
    setIsUserDropdownOpen(false);
  };

  // Close dropdown when clicking outside
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

  // Get current page title
  const navItems = [
    { path: '/', title: 'Home' },
    { path: '/documents', title: 'Documents' },
    { path: '/progress', title: 'Progress' },
    { path: '/activity', title: 'Activity' },
    { path: '/search', title: 'Search' },
    { path: '/settings', title: 'Settings' },
  ];
  const currentPageTitle =
    navItems.find(item => location.pathname === item.path)?.title || 'Documents';

  // Show loading while checking authentication status
  if (isCheckingAuth) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-800">
      {/* Header */}
      <div className="flex h-16 w-full items-center justify-between">
        {/* Mobile Navigation Button with CSS animations */}
        <HamburgerMenu />

        {/* Header Title */}
        <h1 className="px-6 text-xl font-bold lg:ml-44 dark:text-white">{currentPageTitle}</h1>

        {/* User Dropdown */}
        <div
          className="relative flex w-full items-center justify-end space-x-4 p-4"
          ref={dropdownRef}
        >
          <button
            onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
            className="relative block text-gray-800 dark:text-gray-200"
          >
            <UserIcon size={20} />
          </button>

          {isUserDropdownOpen && (
            <div className="absolute right-4 top-16 z-20 pt-4 transition duration-200">
              <div className="w-40 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-gray-700 dark:shadow-gray-800">
                <div
                  className="py-1"
                  role="menu"
                  aria-orientation="vertical"
                  aria-labelledby="options-menu"
                >
                  <Link
                    to="/settings"
                    onClick={() => setIsUserDropdownOpen(false)}
                    className="block px-4 py-2 text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                    role="menuitem"
                  >
                    <span className="flex flex-col">
                      <span>Settings</span>
                    </span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="block w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
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
            className="flex cursor-pointer items-center gap-2 py-4 text-gray-500 dark:text-white"
          >
            <span>{userData ? ('username' in userData ? userData.username : 'User') : 'User'}</span>
            <span
              className="text-gray-800 transition-transform duration-200 dark:text-gray-200"
              style={{ transform: isUserDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <ChevronDown size={20} />
            </span>
          </button>
        </div>
      </div>

      {/* Main Content */}
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
