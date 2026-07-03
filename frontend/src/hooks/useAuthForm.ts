import { useCallback, useState, type SyntheticEvent } from 'react';
import { useGetInfo } from '../generated/anthoLumeAPIV1';
import { useAuth } from '../auth/AuthContext';
import { useToasts } from '../components/ToastContext';
import { getErrorMessage } from '../utils/errors';

export interface UseAuthFormResult {
  username: string;
  password: string;
  isLoading: boolean;
  isLoadingInfo: boolean;
  registrationEnabled: boolean;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  submit: (e: SyntheticEvent<HTMLFormElement>) => Promise<void>;
}

// Shared auth form state + submit for login/register. Server error messages are surfaced via the
// generated ErrorResponse contract rather than hardcoded fallbacks.
export function useAuthForm(mode: 'login' | 'register'): UseAuthFormResult {
  const { login, register } = useAuth();
  const { showError } = useToasts();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { data: infoData, isLoading: isLoadingInfo } = useGetInfo({
    query: { staleTime: Infinity },
  });
  const registrationEnabled = infoData?.status === 200 ? infoData.data.registration_enabled : false;

  const submit = useCallback(
    async (e: SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      setIsLoading(true);
      try {
        if (mode === 'login') {
          await login(username, password);
        } else {
          await register(username, password);
        }
      } catch (error) {
        showError(
          getErrorMessage(error, mode === 'login' ? 'Login failed' : 'Registration failed')
        );
      } finally {
        setIsLoading(false);
      }
    },
    [mode, login, register, username, password, showError]
  );

  return {
    username,
    password,
    isLoading,
    isLoadingInfo,
    registrationEnabled,
    setUsername,
    setPassword,
    submit,
  };
}
