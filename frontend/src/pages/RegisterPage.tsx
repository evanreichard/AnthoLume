import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useAuthForm } from '../hooks/useAuthForm';
import { AuthFormView, authFormFooter } from './AuthFormView';

export default function RegisterPage() {
  const { isAuthenticated, isCheckingAuth } = useAuth();
  const navigate = useNavigate();
  const {
    username,
    password,
    isLoading,
    isLoadingInfo,
    registrationEnabled,
    setUsername,
    setPassword,
    submit,
  } = useAuthForm('register');

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated) {
      navigate('/', { replace: true });
      return;
    }

    if (!isLoadingInfo && !registrationEnabled) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, isCheckingAuth, isLoadingInfo, navigate, registrationEnabled]);

  return (
    <AuthFormView
      username={username}
      password={password}
      isLoading={isLoading}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onSubmit={submit}
      submitLabel="Register"
      submittingLabel="Registering..."
      inputsDisabled={isLoadingInfo || !registrationEnabled}
      footer={authFormFooter({ to: '/login', text: 'Login here.' }, true)}
    />
  );
}
