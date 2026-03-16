import { Link, useLocation, Outlet, Navigate } from 'react-router-dom';
import { useGetMe } from '../generated/anthoLumeAPIV1';
import { useAuth } from '../auth/AuthContext';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/documents', label: 'Documents', icon: 'documents' },
  { path: '/progress', label: 'Progress', icon: 'activity' },
  { path: '/activity', label: 'Activity', icon: 'activity' },
  { path: '/search', label: 'Search', icon: 'search' },
];

export default function Layout() {
  const location = useLocation();
  const { isAuthenticated, user, logout } = useAuth();
  const { data } = useGetMe(isAuthenticated ? {} : undefined);
  const userData = data?.data || user;

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="bg-gray-100 dark:bg-gray-800 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between w-full h-16">
        {/* Mobile Navigation Button */}
        <div className="flex flex-col z-40 relative ml-6">
          <input
            type="checkbox"
            className="absolute lg:hidden z-50 -top-2 w-7 h-7 flex cursor-pointer opacity-0"
            id="mobile-nav-toggle"
          />
          <span className="lg:hidden bg-black w-7 h-0.5 z-40 mt-0.5 dark:bg-white"></span>
          <span className="lg:hidden bg-black w-7 h-0.5 z-40 mt-1 dark:bg-white"></span>
          <span className="lg:hidden bg-black w-7 h-0.5 z-40 mt-1 dark:bg-white"></span>
          <div
            id="menu"
            className="fixed -ml-6 h-full w-56 lg:w-48 bg-white dark:bg-gray-700 shadow-lg"
          >
            <div className="h-16 flex justify-end lg:justify-around">
              <p className="text-xl font-bold dark:text-white text-right my-auto pr-8 lg:pr-0">
                AnthoLume
              </p>
            </div>
            <nav className="flex flex-col">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center justify-start w-full p-2 pl-6 my-2 transition-colors duration-200 border-l-4 ${
                    location.pathname === item.path
                      ? 'border-purple-500 dark:text-white'
                      : 'border-transparent text-gray-400 hover:text-gray-800 dark:hover:text-gray-100'
                  }`}
                >
                  <span className="mx-4 text-sm font-normal">{item.label}</span>
                </Link>
              ))}
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

        {/* Header Title */}
        <h1 className="text-xl font-bold dark:text-white px-6 lg:ml-44">
          <Link to="/documents">Documents</Link>
        </h1>

        {/* User Dropdown */}
        <div className="relative flex items-center justify-end w-full p-4 space-x-4">
          <input type="checkbox" id="user-dropdown-button" className="hidden" />
          <div
            id="user-dropdown"
            className="transition duration-200 z-20 absolute right-4 top-16 pt-4"
          >
            <div className="w-40 origin-top-right bg-white rounded-md shadow-lg dark:shadow-gray-800 dark:bg-gray-700 ring-1 ring-black ring-opacity-5">
              <div className="py-1">
                <Link
                  to="/settings"
                  className="block px-4 py-2 text-md text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:text-white dark:hover:bg-gray-600"
                >
                  Settings
                </Link>
                <button
                  onClick={handleLogout}
                  className="block px-4 py-2 text-md text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:text-white dark:hover:bg-gray-600 w-full text-left"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
          <label htmlFor="user-dropdown-button">
            <div className="flex items-center gap-2 text-gray-500 dark:text-white text-md py-4 cursor-pointer">
              <span>{userData?.username || 'User'}</span>
            </div>
          </label>
        </div>
      </div>

      {/* Main Content */}
      <main className="relative overflow-hidden">
        <div id="container" className="h-[100dvh] px-4 overflow-auto md:px-6 lg:ml-48">
          <Outlet />
        </div>
      </main>
    </div>
  );
}