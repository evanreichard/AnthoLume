interface LoadingIconProps {
  size?: number;
  className?: string;
}

const spinnerAnimation = 'spinner_rcyq 1.2s cubic-bezier(0.52, 0.6, 0.25, 0.99) infinite';

const spinnerPath = 'M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,20a9,9,0,1,1,9-9A9,9,0,0,1,12,21Z';

export function LoadingIcon({ size = 24, className = '' }: LoadingIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <style>
        {`
          @keyframes spinner_rcyq {
            0% {
              transform: translate(12px, 12px) scale(0);
              opacity: 1;
            }
            100% {
              transform: translate(0, 0) scale(1);
              opacity: 0;
            }
          }
        `}
      </style>
      <path
        d={spinnerPath}
        transform="translate(12, 12) scale(0)"
        style={{ animation: spinnerAnimation }}
      />
      <path
        d={spinnerPath}
        transform="translate(12, 12) scale(0)"
        style={{ animation: spinnerAnimation, animationDelay: '0.4s' }}
      />
      <path
        d={spinnerPath}
        transform="translate(12, 12) scale(0)"
        style={{ animation: spinnerAnimation, animationDelay: '0.8s' }}
      />
    </svg>
  );
}
