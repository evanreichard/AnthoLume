import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, Outlet, Navigate } from 'react-router-dom';
import { useGetMe } from '../generated/anthoLumeAPIV1';
import { useAuth } from '../auth/AuthContext';
import { User, ChevronDown } from 'lucide-react';
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
  const currentPageTitle = navItems.find(item => location.pathname === item.path)?.title || 'Documents';

  // Show loading while checking authentication status
  if (isCheckingAuth) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="bg-gray-100 dark:bg-gray-800 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between w-full h-16">
        {/* Mobile Navigation Button with CSS animations */}
        <HamburgerMenu />

        {/* Header Title */}
        <h1 className="text-xl font-bold dark:text-white px-6 lg:ml-44">
          {currentPageTitle}
        </h1>

        {/* User Dropdown */}
        <div className="relative flex items-center justify-end w-full p-4 space-x-4" ref={dropdownRef}>
          <button
            onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
            className="relative block text-gray-800 dark:text-gray-200"
          >
            <User size={20} />
          </button>

          {isUserDropdownOpen && (
            <div className="transition duration-200 z-20 absolute right-4 top-16 pt-4">
              <div className="w-40 origin-top-right bg-white rounded-md shadow-lg dark:shadow-gray-800 dark:bg-gray-700 ring-1 ring-black ring-opacity-5">
                <div
                  className="py-1"
                  role="menu"
                  aria-orientation="vertical"
                  aria-labelledby="options-menu"
                >
                  <Link
                    to="/settings"
                    onClick={() => setIsUserDropdownOpen(false)}
                    className="block px-4 py-2 text-md text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:text-white dark:hover:bg-gray-600"
                    role="menuitem"
                  >
                    <span className="flex flex-col">
                      <span>Settings</span>
                    </span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="block px-4 py-2 text-md text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:text-white dark:hover:bg-gray-600 w-full text-left"
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
            className="flex items-center gap-2 text-gray-500 dark:text-white text-md py-4 cursor-pointer"
          >
            <span>{userData?.username || 'User'}</span>
            <span className="text-gray-800 dark:text-gray-200 transition-transform duration-200" style={{ transform: isUserDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <ChevronDown size={20} />
            </span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="relative overflow-hidden" style={{ height: 'calc(100dvh - 4rem - env(safe-area-inset-top))' }}>
        <div id="container" className="h-[100dvh] px-4 overflow-auto md:px-6 lg:ml-48" style={{ paddingBottom: 'calc(5em + env(safe-area-inset-bottom) * 2)' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}