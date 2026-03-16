import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Toast, ToastType, ToastProps } from './Toast';

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => string;
  showInfo: (message: string, duration?: number) => string;
  showWarning: (message: string, duration?: number) => string;
  showError: (message: string, duration?: number) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<(ToastProps & { id: string })[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration?: number): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message, duration, onClose: removeToast }]);
    return id;
  }, [removeToast]);

  const showInfo = useCallback((message: string, duration?: number) => {
    return showToast(message, 'info', duration);
  }, [showToast]);

  const showWarning = useCallback((message: string, duration?: number) => {
    return showToast(message, 'warning', duration);
  }, [showToast]);

  const showError = useCallback((message: string, duration?: number) => {
    return showToast(message, 'error', duration);
  }, [showToast]);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, showInfo, showWarning, showError, removeToast, clearToasts }}>
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
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <div className="pointer-events-auto">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} />
        ))}
      </div>
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
