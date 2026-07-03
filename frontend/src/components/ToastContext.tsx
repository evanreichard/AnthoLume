import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Toast, ToastType, ToastProps } from './Toast';

interface ToastUpdate {
  message?: string;
  type?: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => string;
  showInfo: (message: string, duration?: number) => string;
  showWarning: (message: string, duration?: number) => string;
  showError: (message: string, duration?: number) => string;
  updateToast: (id: string, update: ToastUpdate) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<(ToastProps & { id: string })[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration?: number): string => {
      const id = crypto.randomUUID();
      setToasts(prev => [...prev, { id, type, message, duration, onClose: removeToast }]);
      return id;
    },
    [removeToast]
  );

  const showInfo = useCallback(
    (message: string, duration?: number) => {
      return showToast(message, 'info', duration);
    },
    [showToast]
  );

  const showWarning = useCallback(
    (message: string, duration?: number) => {
      return showToast(message, 'warning', duration);
    },
    [showToast]
  );

  const showError = useCallback(
    (message: string, duration?: number) => {
      return showToast(message, 'error', duration);
    },
    [showToast]
  );

  // In-Place Update - Long-running flows show a persistent toast (duration 0) that resolves into its result toast; changing duration restarts the Toast's auto-dismiss timer.
  const updateToast = useCallback((id: string, update: ToastUpdate) => {
    setToasts(prev => prev.map(toast => (toast.id === id ? { ...toast, ...update } : toast)));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider
      value={{ showToast, showInfo, showWarning, showError, updateToast, removeToast, clearToasts }}
    >
      {children}
      <ToastContainer toasts={toasts} />
    </ToastContext.Provider>
  );
}

interface ToastContainerProps {
  toasts: (ToastProps & { id: string })[];
}

function ToastContainer({ toasts }: ToastContainerProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast {...toast} />
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToasts must be used within a ToastProvider');
  }
  return context;
}
