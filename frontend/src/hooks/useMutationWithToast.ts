import { useToasts } from '../components/ToastContext';
import { getErrorMessage, getResponseError, type ApiResponseLike } from '../utils/errors';

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
      onSuccess: (response: ApiResponseLike) => {
        const message = getResponseError(response);
        if (message) {
          showError(`${error}: ${message}`);
          return;
        }
        onSuccess?.();
        showInfo(success);
      },
      onError: (err: unknown) => showError(`${error}: ${getErrorMessage(err)}`),
    };
  };
}
