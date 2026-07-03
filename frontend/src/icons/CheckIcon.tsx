import { BaseIcon } from './BaseIcon';

interface CheckIconProps {
  size?: number;
  className?: string;
  disabled?: boolean;
}

export function CheckIcon({ size = 24, className = '', disabled = false }: CheckIconProps) {
  return (
    <BaseIcon size={size} className={className} disabled={disabled}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22ZM16.2929 8.70711C16.6834 9.09763 16.6834 9.7308 16.2929 10.1213L10.1213 16.2929C9.73072 16.6834 9.09755 16.6834 8.70703 16.2929L6.70703 14.2929C6.3165 13.9024 6.3165 13.2692 6.70703 12.8787C7.09755 12.4882 7.73072 12.4882 8.12124 12.8787L9.41413 14.1716L14.8787 8.70711C15.2692 8.31658 15.9024 8.31658 16.2929 8.70711Z"
      />
    </BaseIcon>
  );
}
