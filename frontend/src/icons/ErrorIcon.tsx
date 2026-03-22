import { BaseIcon } from './BaseIcon';

interface ErrorIconProps {
  size?: number;
  className?: string;
  disabled?: boolean;
}

export function ErrorIcon({ size = 24, className = '', disabled = false }: ErrorIconProps) {
  return (
    <BaseIcon size={size} className={className} disabled={disabled}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM8.96967 8.96967C9.26256 8.67678 9.73744 8.67678 10.0303 8.96967L12 10.9393L13.9697 8.96967C14.2626 8.67678 14.7374 8.67678 15.0303 8.96967C15.3232 9.26256 15.3232 9.73744 15.0303 10.0303L13.0607 12L15.0303 13.9697C15.3232 14.2626 15.3232 14.7374 15.0303 15.0303C14.7374 15.3232 14.2626 15.3232 13.9697 15.0303L12 13.0607L10.0303 15.0303C9.73744 15.3232 9.26256 15.3232 8.96967 15.0303C8.67678 14.7374 8.67678 14.2626 8.96967 13.9697L10.9393 12L8.96967 10.0303C8.67678 9.73744 8.67678 9.26256 8.96967 8.96967Z"
      />
    </BaseIcon>
  );
}
