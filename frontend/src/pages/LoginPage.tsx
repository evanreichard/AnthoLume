import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useAuthForm } from '../hooks/useAuthForm';
import { AuthFormView, authFormFooter } from './AuthFormView';

export default function LoginPage() {
  const { isAuthenticated, isCheckingAuth } = useAuth();
  const navigate = useNavigate();
  const { username, password, isLoading, registrationEnabled, setUsername, setPassword, submit } =
    useAuthForm('login');

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, isCheckingAuth, navigate]);

  return (
    <AuthFormView
      username={username}
      password={password}
      isLoading={isLoading}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onSubmit={submit}
      submitLabel="Login"
      submittingLabel="Logging in..."
      footer={authFormFooter({ to: '/register', text: 'Register here.' }, registrationEnabled)}
    />
  );
}
