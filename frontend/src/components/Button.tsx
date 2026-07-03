import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../utils/cn';

interface BaseButtonProps {
  variant?: 'default' | 'secondary';
  children: React.ReactNode;
  className?: string;
}

type ButtonProps = BaseButtonProps & ButtonHTMLAttributes<HTMLButtonElement>;

const getVariantClasses = (variant: 'default' | 'secondary' = 'default'): string => {
  const baseClass =
    'inline-flex items-center justify-center px-4 py-2 font-medium transition duration-100 ease-in disabled:cursor-not-allowed disabled:opacity-50';

  if (variant === 'secondary') {
    return `${baseClass} bg-content text-content-inverse shadow-md hover:bg-content-muted disabled:hover:bg-content`;
  }

  return `${baseClass} bg-primary-500 text-primary-foreground hover:bg-primary-700 disabled:hover:bg-primary-500`;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', children, className, ...props }, ref) => {
    return (
      <button ref={ref} className={cn(getVariantClasses(variant), className)} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
