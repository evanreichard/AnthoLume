import { useCallback, useEffect, useState } from 'react';
import { InfoIcon, WarningIcon, ErrorIcon, CloseIcon } from '../icons';

export type ToastType = 'info' | 'warning' | 'error';

export interface ToastProps {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  onClose?: (id: string) => void;
}

const baseStyles =
  'flex items-center gap-3 rounded-lg border-l-4 p-4 shadow-lg transition-all duration-300';

const typeStyles: Record<ToastType, string> = {
  info: 'border-secondary-500 bg-secondary-100',
  warning: 'border-yellow-500 bg-yellow-100',
  error: 'border-red-500 bg-red-100',
};

const iconStyles: Record<ToastType, string> = {
  info: 'text-secondary-700',
  warning: 'text-yellow-700',
  error: 'text-red-700',
};

const textStyles: Record<ToastType, string> = {
  info: 'text-secondary-900',
  warning: 'text-yellow-900',
  error: 'text-red-900',
};

export function Toast({ id, type, message, duration = 5000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  const handleClose = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(() => {
      setIsVisible(false);
      onClose?.(id);
    }, 300);
  }, [id, onClose]);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(handleClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, handleClose]);

  if (!isVisible) {
    return null;
  }

  const icons = {
    info: <InfoIcon size={20} className={iconStyles[type]} />,
    warning: <WarningIcon size={20} className={iconStyles[type]} />,
    error: <ErrorIcon size={20} className={iconStyles[type]} />,
  };

  return (
    <div
      className={`${baseStyles} ${typeStyles[type]} ${
        isAnimatingOut ? 'translate-x-full opacity-0' : 'animate-slideInRight opacity-100'
      }`}
    >
      {icons[type]}
      <p className={`flex-1 text-sm font-medium ${textStyles[type]}`}>{message}</p>
      <button
        onClick={handleClose}
        className={`ml-2 opacity-70 transition-opacity hover:opacity-100 ${textStyles[type]}`}
        aria-label="Close"
      >
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
