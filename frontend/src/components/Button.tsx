import { ButtonHTMLAttributes, AnchorHTMLAttributes, forwardRef } from 'react';

interface BaseButtonProps {
  variant?: 'default' | 'secondary';
  children: React.ReactNode;
  className?: string;
}

type ButtonProps = BaseButtonProps & ButtonHTMLAttributes<HTMLButtonElement>;
type LinkProps = BaseButtonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

const getVariantClasses = (variant: 'default' | 'secondary' = 'default'): string => {
  const baseClass =
    'h-full w-full px-2 py-1 font-medium transition duration-100 ease-in disabled:cursor-not-allowed disabled:opacity-50';

  if (variant === 'secondary') {
    return `${baseClass} bg-content text-content-inverse shadow-md hover:bg-content-muted disabled:hover:bg-content`;
  }

  return `${baseClass} bg-primary-500 text-primary-foreground hover:bg-primary-700 disabled:hover:bg-primary-500`;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', children, className = '', ...props }, ref) => {
    return (
      <button ref={ref} className={`${getVariantClasses(variant)} ${className}`.trim()} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export const ButtonLink = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ variant = 'default', children, className = '', ...props }, ref) => {
    return (
      <a ref={ref} className={`${getVariantClasses(variant)} ${className}`.trim()} {...props}>
        {children}
      </a>
    );
  }
);

ButtonLink.displayName = 'ButtonLink';
