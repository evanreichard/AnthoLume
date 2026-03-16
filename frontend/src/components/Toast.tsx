import { useEffect, useState } from 'react';
import { Info, AlertTriangle, XCircle, X } from 'lucide-react';

export type ToastType = 'info' | 'warning' | 'error';

export interface ToastProps {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  onClose?: (id: string) => void;
}

const getToastStyles = (type: ToastType) => {
  const baseStyles = 'flex items-center gap-3 p-4 rounded-lg shadow-lg border-l-4 transition-all duration-300';
  
  const typeStyles = {
    info: 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 dark:border-blue-400',
    warning: 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-500 dark:border-yellow-400',
    error: 'bg-red-50 dark:bg-red-900/30 border-red-500 dark:border-red-400',
  };

  const iconStyles = {
    info: 'text-blue-600 dark:text-blue-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    error: 'text-red-600 dark:text-red-400',
  };

  const textStyles = {
    info: 'text-blue-800 dark:text-blue-200',
    warning: 'text-yellow-800 dark:text-yellow-200',
    error: 'text-red-800 dark:text-red-200',
  };

  return { baseStyles, typeStyles, iconStyles, textStyles };
};

export function Toast({ id, type, message, duration = 5000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  const { baseStyles, typeStyles, iconStyles, textStyles } = getToastStyles(type);

  const handleClose = () => {
    setIsAnimatingOut(true);
    setTimeout(() => {
      setIsVisible(false);
      onClose?.(id);
    }, 300);
  };

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(handleClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration]);

  if (!isVisible) {
    return null;
  }

  const icons = {
    info: <Info size={20} className={iconStyles[type]} />,
    warning: <AlertTriangle size={20} className={iconStyles[type]} />,
    error: <XCircle size={20} className={iconStyles[type]} />,
  };

  return (
    <div
      className={`${baseStyles} ${typeStyles[type]} ${isAnimatingOut ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}`}
    >
      {icons[type]}
      <p className={`flex-1 text-sm font-medium ${textStyles[type]}`}>
        {message}
      </p>
      <button
        onClick={handleClose}
        className={`ml-2 opacity-70 hover:opacity-100 transition-opacity ${textStyles[type]}`}
        aria-label="Close"
      >
        <X size={18} />
      </button>
    </div>
  );
}
