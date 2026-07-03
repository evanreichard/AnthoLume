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

interface RunToastMutationOptions<T> {
  error: string;
  success?: string;
  onSuccess?: (response: T) => void;
}

/**
 * Imperative sibling of `useMutationWithToast` for flows that must `await` a result (e.g. keep an
 * editor open on failure). Runs the action, treats non-2xx as failure, toasts accordingly, and
 * resolves to `true` only on success.
 */
export function useToastMutation() {
  const { showInfo, showError } = useToasts();

  return async function runWithToast<T extends ApiResponseLike>(
    action: () => Promise<T>,
    { error, success, onSuccess }: RunToastMutationOptions<T>
  ): Promise<boolean> {
    try {
      const response = await action();
      const message = getResponseError(response);
      if (message) {
        showError(`${error}: ${message}`);
        return false;
      }
      onSuccess?.(response);
      if (success) {
        showInfo(success);
      }
      return true;
    } catch (err) {
      showError(`${error}: ${getErrorMessage(err)}`);
      return false;
    }
  };
}
