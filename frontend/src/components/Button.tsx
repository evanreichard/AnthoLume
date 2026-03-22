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
    'transition duration-100 ease-in font-medium w-full h-full px-2 py-1 text-white disabled:cursor-not-allowed disabled:opacity-50';

  if (variant === 'secondary') {
    return `${baseClass} bg-black shadow-md hover:text-black hover:bg-white disabled:hover:text-white disabled:hover:bg-black`;
  }

  return `${baseClass} bg-gray-500 dark:text-gray-800 hover:bg-gray-800 dark:hover:bg-gray-100 disabled:hover:bg-gray-500 dark:disabled:hover:bg-transparent`;
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
