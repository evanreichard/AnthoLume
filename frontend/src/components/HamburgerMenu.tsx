import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, FileText, Activity, Search, Settings } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  title: string;
}

const navItems: NavItem[] = [
  { path: '/', label: 'Home', icon: Home, title: 'Home' },
  { path: '/documents', label: 'Documents', icon: FileText, title: 'Documents' },
  { path: '/progress', label: 'Progress', icon: Activity, title: 'Progress' },
  { path: '/activity', label: 'Activity', icon: Activity, title: 'Activity' },
  { path: '/search', label: 'Search', icon: Search, title: 'Search' },
];

const adminSubItems: NavItem[] = [
  { path: '/admin', label: 'General', icon: Settings, title: 'General' },
  { path: '/admin/import', label: 'Import', icon: Settings, title: 'Import' },
  { path: '/admin/users', label: 'Users', icon: Settings, title: 'Users' },
  { path: '/admin/logs', label: 'Logs', icon: Settings, title: 'Logs' },
];

// Helper function to check if pathname has a prefix
function hasPrefix(path: string, prefix: string): boolean {
  return path.startsWith(prefix);
}

export default function HamburgerMenu() {
  const location = useLocation();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const isAdmin = user?.is_admin ?? false;

  return (
    <div className="flex flex-col z-40 relative ml-6">
      {/* Checkbox input for state management */}
      <input
        type="checkbox"
        className="absolute lg:hidden z-50 -top-2 w-7 h-7 flex cursor-pointer opacity-0"
        id="mobile-nav-checkbox"
        checked={isOpen}
        onChange={(e) => setIsOpen(e.target.checked)}
      />
      
      {/* Hamburger icon lines with CSS animations - hidden on desktop */}
      <span
        className="lg:hidden bg-black w-7 h-0.5 z-40 mt-0.5 dark:bg-white transition-transform transition-background transition-opacity duration-500"
        style={{
          transformOrigin: '5px 0px',
          transition: 'transform 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), background 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), opacity 0.55s ease',
          transform: isOpen ? 'rotate(45deg) translate(2px, -2px)' : 'none',
        }}
      />
      <span
        className="lg:hidden bg-black w-7 h-0.5 z-40 mt-1 dark:bg-white transition-transform transition-background transition-opacity duration-500"
        style={{
          transformOrigin: '0% 100%',
          transition: 'transform 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), background 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), opacity 0.55s ease',
          opacity: isOpen ? 0 : 1,
          transform: isOpen ? 'rotate(0deg) scale(0.2, 0.2)' : 'none',
        }}
      />
      <span
        className="lg:hidden bg-black w-7 h-0.5 z-40 mt-1 dark:bg-white transition-transform transition-background transition-opacity duration-500"
        style={{
          transformOrigin: '0% 0%',
          transition: 'transform 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), background 0.5s cubic-bezier(0.77, 0.2, 0.05, 1), opacity 0.55s ease',
          transform: isOpen ? 'rotate(-45deg) translate(0, 6px)' : 'none',
        }}
      />
      
      {/* Navigation menu with slide animation */}
      <div
        id="menu"
        className="fixed -ml-6 h-full w-56 lg:w-48 bg-white dark:bg-gray-700 shadow-lg"
        style={{
          top: 0,
          paddingTop: 'env(safe-area-inset-top)',
          transformOrigin: '0% 0%',
          // On desktop (lg), always show the menu via CSS class
          // On mobile, control via state
          transform: isOpen ? 'none' : 'translate(-100%, 0)',
          transition: 'transform 0.5s cubic-bezier(0.77, 0.2, 0.05, 1)',
        }}
      >
        {/* Desktop override - always visible */}
        <style>{`
          @media (min-width: 1024px) {
            #menu {
              transform: none !important;
            }
          }
        `}</style>
        <div className="h-16 flex justify-end lg:justify-around">
          <p className="text-xl font-bold dark:text-white text-right my-auto pr-8 lg:pr-0">
            AnthoLume
          </p>
        </div>
        <nav>
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setIsOpen(false)}
              className={`flex items-center justify-start w-full p-2 pl-6 my-2 transition-colors duration-200 border-l-4 ${
                location.pathname === item.path
                  ? 'border-purple-500 dark:text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-800 dark:hover:text-gray-100'
              }`}
            >
              <item.icon size={20} />
              <span className="mx-4 text-sm font-normal">{item.label}</span>
            </Link>
          ))}
          
          {/* Admin section - only visible for admins */}
          {isAdmin && (
            <div className={`flex flex-col gap-4 p-2 pl-6 my-2 transition-colors duration-200 border-l-4 ${
              hasPrefix(location.pathname, '/admin')
                ? 'border-purple-500 dark:text-white'
                : 'border-transparent text-gray-400'
            }`}>
              {/* Admin header - always shown */}
              <Link
                to="/admin"
                onClick={() => setIsOpen(false)}
                className={`flex justify-start w-full ${
                  location.pathname === '/admin' && !hasPrefix(location.pathname, '/admin/')
                    ? 'dark:text-white'
                    : 'text-gray-400 hover:text-gray-800 dark:hover:text-gray-100'
                }`}
              >
                <Settings size={20} />
                <span className="mx-4 text-sm font-normal">Admin</span>
              </Link>
              
              {hasPrefix(location.pathname, '/admin') && (
                <div className="flex flex-col gap-4">
                  {adminSubItems.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsOpen(false)}
                      className={`flex justify-start w-full ${
                        location.pathname === item.path
                          ? 'dark:text-white'
                          : 'text-gray-400 hover:text-gray-800 dark:hover:text-gray-100'
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
          className="flex flex-col gap-2 justify-center items-center p-6 w-full absolute bottom-0 text-black dark:text-white"
          target="_blank"
          href="https://gitea.va.reichard.io/evan/AnthoLume"
        >
          <span className="text-xs">v1.0.0</span>
        </a>
      </div>
    </div>
  );
}
