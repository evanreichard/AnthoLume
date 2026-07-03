import { useState, SyntheticEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToasts } from '../components/ToastContext';
import { useGetInfo } from '../generated/anthoLumeAPIV1';
import { AuthFormView, authFormFooter } from './AuthFormView';
import { getRegistrationEnabled } from './LoginPage';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { register, isAuthenticated, isCheckingAuth } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToasts();
  const { data: infoData, isLoading: isLoadingInfo } = useGetInfo({
    query: {
      staleTime: Infinity,
    },
  });

  const registrationEnabled = getRegistrationEnabled(infoData);

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated) {
      navigate('/', { replace: true });
      return;
    }

    if (!isLoadingInfo && !registrationEnabled) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, isCheckingAuth, isLoadingInfo, navigate, registrationEnabled]);

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await register(username, password);
    } catch (_err) {
      showError(registrationEnabled ? 'Registration failed' : 'Registration is disabled');
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
      submitLabel="Register"
      submittingLabel="Registering..."
      inputsDisabled={isLoadingInfo || !registrationEnabled}
      footer={authFormFooter({ to: '/login', text: 'Login here.' }, true)}
    />
  );
}
