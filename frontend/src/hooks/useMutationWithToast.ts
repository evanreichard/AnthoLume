import { useToasts } from '../components/ToastContext';
import { getErrorMessage } from '../utils/errors';

interface ApiResponse {
  status: number;
  data: unknown;
}

interface ToastMutationOptions {
  success: string;
  error: string;
  onSuccess?: () => void;
}

/**
 * Builds `{ onSuccess, onError }` for a generated mutation's `.mutate(vars, options)` call,
 * centralizing the shared "toast success / toast error / treat non-2xx as failure" pattern.
 */
export function useMutationWithToast() {
  const { showInfo, showError } = useToasts();

  return function toastMutationOptions({ success, error, onSuccess }: ToastMutationOptions) {
    return {
      onSuccess: (response: ApiResponse) => {
        if (response.status < 200 || response.status >= 300) {
          showError(`${error}: ${getErrorMessage(response.data)}`);
          return;
        }
        onSuccess?.();
        showInfo(success);
      },
      onError: (err: unknown) => showError(`${error}: ${getErrorMessage(err)}`),
    };
  };
}
