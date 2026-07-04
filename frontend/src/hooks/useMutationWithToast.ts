import { useToasts } from '../components/ToastContext';
import { getErrorMessage } from '../utils/errors';

interface ToastMutationOptions {
  success: string;
  error: string;
  onSuccess?: () => void;
}

/**
 * Builds `{ onSuccess, onError }` for a generated mutation's `.mutate(vars, options)` call,
 * centralizing the shared "toast success / toast error" pattern. The generated client throws on
 * non-2xx, so success and failure map cleanly onto React Query's onSuccess/onError.
 */
export function useMutationWithToast() {
  const { showInfo, showError } = useToasts();

  return function toastMutationOptions({ success, error, onSuccess }: ToastMutationOptions) {
    return {
      onSuccess: () => {
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
  onSuccess?: (result: T) => void;
}

/**
 * Imperative sibling of `useMutationWithToast` for flows that must `await` a result (e.g. keep an
 * editor open on failure). Runs the action, toasts on success/failure, and resolves to `true` only
 * when the action succeeds.
 */
export function useToastMutation() {
  const { showInfo, showError } = useToasts();

  return async function runWithToast<T>(
    action: () => Promise<T>,
    { error, success, onSuccess }: RunToastMutationOptions<T>
  ): Promise<boolean> {
    try {
      const result = await action();
      onSuccess?.(result);
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
