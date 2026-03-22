import { BaseIcon } from './BaseIcon';

interface FolderOpenIconProps {
  size?: number;
  className?: string;
  disabled?: boolean;
}

export function FolderOpenIcon({ size = 24, className = '', disabled = false }: FolderOpenIconProps) {
  return (
    <BaseIcon size={size} className={className} disabled={disabled}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 6C3 4.34315 4.34315 3 6 3H9.41421C9.81948 3 10.2056 3.17664 10.4718 3.48547L12.4359 5.74999H18C19.6569 5.74999 21 7.09313 21 8.74999V14.5C21 16.1569 19.6569 17.5 18 17.5H16.9282C16.5234 17.5 16.1376 17.3236 15.8714 17.0152L13.9071 14.75H10.0929L8.12855 17.0152C7.86237 17.3236 7.4766 17.5 7.0718 17.5H6C4.34315 17.5 3 16.1569 3 14.5V6ZM18 7.24999H12C11.5947 7.24999 11.2086 7.07334 10.9424 6.76452L8.97821 4.49999H6C5.17157 4.49999 4.5 5.17157 4.5 6V14.5C4.5 15.3284 5.17157 16 6 16H6.5718L8.53615 13.7348C8.80233 13.4264 9.1881 13.25 9.5929 13.25H14.4071C14.8119 13.25 15.1977 13.4264 15.4639 13.7348L17.4282 16H18C18.8284 16 19.5 15.3284 19.5 14.5V8.74999C19.5 7.92156 18.8284 7.24999 18 7.24999Z"
      />
    </BaseIcon>
  );
}
