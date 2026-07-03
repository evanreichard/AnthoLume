import { BaseIcon } from './BaseIcon';

interface WarningIconProps {
  size?: number;
  className?: string;
  disabled?: boolean;
}

export function WarningIcon({ size = 24, className = '', disabled = false }: WarningIconProps) {
  return (
    <BaseIcon size={size} className={className} disabled={disabled}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.2859 3.85976C10.9317 2.71341 12.5684 2.71341 13.2141 3.85976L20.7641 16.9978C21.4119 18.1483 20.5822 19.5598 19.2501 19.5598H4.24996C2.9178 19.5598 2.08812 18.1483 2.73591 16.9978L10.2859 3.85976ZM10.9499 13.3098C10.9499 13.724 11.2857 14.0598 11.6999 14.0598C12.1141 14.0598 12.4499 13.724 12.4499 13.3098V8.30979C12.4499 7.89558 12.1141 7.55979 11.6999 7.55979C11.2857 7.55979 10.9499 7.89558 10.9499 8.30979V13.3098ZM10.9499 16.3098C10.9499 16.724 11.2857 17.0598 11.6999 17.0598C12.1141 17.0598 12.4499 16.724 12.4499 16.3098C12.4499 15.8956 12.1141 15.5598 11.6999 15.5598C11.2857 15.5598 10.9499 15.8956 10.9499 16.3098Z"
      />
    </BaseIcon>
  );
}
