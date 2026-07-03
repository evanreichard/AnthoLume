import { useState, SyntheticEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToasts } from '../components/ToastContext';
import { useGetInfo } from '../generated/anthoLumeAPIV1';
import { AuthFormView, authFormFooter } from './AuthFormView';

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

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>) => {
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
    <AuthFormView
      username={username}
      password={password}
      isLoading={isLoading}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
      submitLabel="Login"
      submittingLabel="Logging in..."
      footer={authFormFooter({ to: '/register', text: 'Register here.' }, registrationEnabled)}
    />
  );
}
