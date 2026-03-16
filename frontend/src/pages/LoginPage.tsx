import { useState, FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { login } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      await login(username, password);
    } catch (err) {
      setError('Invalid credentials');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gray-100 dark:bg-gray-800 dark:text-white min-h-screen">
      <div className="flex flex-wrap w-full">
        <div className="flex flex-col w-full md:w-1/2">
          <div
            className="flex flex-col justify-center px-8 pt-8 my-auto md:justify-start md:pt-0 md:px-24 lg:px-32"
          >
            <p className="text-3xl text-center">Welcome.</p>
            <form className="flex flex-col pt-3 md:pt-8" onSubmit={handleSubmit}>
              <div className="flex flex-col pt-4">
                <div className="flex relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                    placeholder="Username"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>
              <div className="flex flex-col pt-4 mb-12">
                <div className="flex relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                    placeholder="Password"
                    required
                    disabled={isLoading}
                  />
                  <span className="absolute -bottom-5 text-red-400 text-xs">{error}</span>
                </div>
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full px-4 py-2 text-base font-semibold text-center text-white transition duration-200 ease-in bg-black shadow-md hover:text-black hover:bg-white focus:outline-none focus:ring-2 disabled:opacity-50"
              >
                {isLoading ? 'Logging in...' : 'Login'}
              </button>
            </form>
            <div className="pt-12 pb-12 text-center">
              <p className="mt-4">
                <a href="/local" className="font-semibold underline">
                  Offline / Local Mode
                </a>
              </p>
            </div>
          </div>
        </div>
        <div className="hidden image-fader w-1/2 shadow-2xl h-screen relative md:block">
          <div className="w-full h-screen object-cover ease-in-out top-0 left-0 bg-gray-300 flex items-center justify-center">
            <span className="text-gray-500">AnthoLume</span>
          </div>
        </div>
      </div>
    </div>
  );
}