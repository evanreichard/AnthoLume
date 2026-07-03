import { BaseIcon } from './BaseIcon';

interface BookIconProps {
  size?: number;
  className?: string;
  disabled?: boolean;
}

export function BookIcon({ size = 24, className = '', disabled = false }: BookIconProps) {
  return (
    <BaseIcon size={size} className={className} disabled={disabled}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 4.5C4 3.11929 5.11929 2 6.5 2H17.5C18.8807 2 20 3.11929 20 4.5V19.5C20 20.8807 18.8807 22 17.5 22H6.5C5.11929 22 4 20.8807 4 19.5V4.5ZM6.5 3.5C5.94772 3.5 5.5 3.94772 5.5 4.5V19.5C5.5 20.0523 5.94772 20.5 6.5 20.5H17.5C18.0523 20.5 18.5 20.0523 18.5 19.5V4.5C18.5 3.94772 18.0523 3.5 17.5 3.5H6.5ZM12 6C12.4142 6 12.75 6.33579 12.75 6.75V11.5H17.5C17.9142 11.5 18.25 11.8358 18.25 12.25C18.25 12.6642 17.9142 13 17.5 13H12.75V17.75C12.75 18.1642 12.4142 18.5 12 18.5C11.5858 18.5 11.25 18.1642 11.25 17.75V13H6.5C6.08579 13 5.75 12.6642 5.75 12.25C5.75 11.8358 6.08579 11.5 6.5 11.5H11.25V6.75C11.25 6.33579 11.5858 6 12 6Z"
      />
    </BaseIcon>
  );
}
