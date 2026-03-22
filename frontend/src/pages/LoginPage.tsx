import { useState, FormEvent, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { useToasts } from '../components/ToastContext';
import { useGetInfo } from '../generated/anthoLumeAPIV1';

interface LoginPageViewProps {
  username: string;
  password: string;
  isLoading: boolean;
  registrationEnabled: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void | Promise<void>;
}

export function getRegistrationEnabled(infoData: unknown): boolean {
  if (!infoData || typeof infoData !== 'object') {
    return false;
  }

  if (!('data' in infoData) || !infoData.data || typeof infoData.data !== 'object') {
    return false;
  }

  if (
    !('registration_enabled' in infoData.data) ||
    typeof infoData.data.registration_enabled !== 'boolean'
  ) {
    return false;
  }

  return infoData.data.registration_enabled;
}

export function LoginPageView({
  username,
  password,
  isLoading,
  registrationEnabled,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: LoginPageViewProps) {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-800 dark:text-white">
      <div className="flex w-full flex-wrap">
        <div className="flex w-full flex-col md:w-1/2">
          <div className="my-auto flex flex-col justify-center px-8 pt-8 md:justify-start md:px-24 md:pt-0 lg:px-32">
            <p className="text-center text-3xl">Welcome.</p>
            <form className="flex flex-col pt-3 md:pt-8" onSubmit={onSubmit}>
              <div className="flex flex-col pt-4">
                <div className="relative flex">
                  <input
                    type="text"
                    value={username}
                    onChange={e => onUsernameChange(e.target.value)}
                    className="w-full flex-1 appearance-none rounded-none border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-600"
                    placeholder="Username"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>
              <div className="mb-12 flex flex-col pt-4">
                <div className="relative flex">
                  <input
                    type="password"
                    value={password}
                    onChange={e => onPasswordChange(e.target.value)}
                    className="w-full flex-1 appearance-none rounded-none border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-600"
                    placeholder="Password"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>
              <Button
                variant="secondary"
                type="submit"
                disabled={isLoading}
                className="w-full px-4 py-2 text-center text-base font-semibold transition duration-200 ease-in focus:outline-none focus:ring-2 disabled:opacity-50"
              >
                {isLoading ? 'Logging in...' : 'Login'}
              </Button>
            </form>
            <div className="py-12 text-center">
              {registrationEnabled && (
                <p>
                  Don&apos;t have an account?{' '}
                  <Link to="/register" className="font-semibold underline">
                    Register here.
                  </Link>
                </p>
              )}
              <p className={registrationEnabled ? 'mt-4' : ''}>
                <a href="/local" className="font-semibold underline">
                  Offline / Local Mode
                </a>
              </p>
            </div>
          </div>
        </div>
        <div className="relative hidden h-screen w-1/2 shadow-2xl md:block">
          <div className="left-0 top-0 flex h-screen w-full items-center justify-center bg-gray-300 object-cover ease-in-out">
            <span className="text-gray-500">AnthoLume</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login, isAuthenticated, isCheckingAuth } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToasts();
  const { data: infoData } = useGetInfo({
    query: {
      staleTime: Infinity,
    },
  });

  const registrationEnabled = getRegistrationEnabled(infoData);

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, isCheckingAuth, navigate]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await login(username, password);
    } catch (_err) {
      showError('Invalid credentials');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LoginPageView
      username={username}
      password={password}
      isLoading={isLoading}
      registrationEnabled={registrationEnabled}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
    />
  );
}
