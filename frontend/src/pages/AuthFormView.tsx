import { SyntheticEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { TextInput } from '../components';

interface AuthFormViewProps {
  username: string;
  password: string;
  isLoading: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: SyntheticEvent<HTMLFormElement>) => void | Promise<void>;

  submitLabel: string;
  submittingLabel: string;
  inputsDisabled?: boolean;
  footer: ReactNode;
}

export function AuthFormView({
  username,
  password,
  isLoading,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  submitLabel,
  submittingLabel,
  inputsDisabled = false,
  footer,
}: AuthFormViewProps) {
  return (
    <div className="min-h-screen bg-canvas text-content">
      <div className="flex w-full flex-wrap">
        <div className="flex w-full flex-col md:w-1/2">
          <div className="my-auto flex flex-col justify-center px-8 pt-8 md:justify-start md:px-24 md:pt-0 lg:px-32">
            <p className="text-center text-3xl">Welcome.</p>
            <form className="flex flex-col pt-3 md:pt-8" onSubmit={onSubmit}>
              <div className="flex flex-col pt-4">
                <div className="relative flex">
                  <TextInput
                    type="text"
                    value={username}
                    onChange={e => onUsernameChange(e.target.value)}
                    placeholder="Username"
                    required
                    disabled={isLoading || inputsDisabled}
                  />
                </div>
              </div>
              <div className="mb-12 flex flex-col pt-4">
                <div className="relative flex">
                  <TextInput
                    type="password"
                    value={password}
                    onChange={e => onPasswordChange(e.target.value)}
                    placeholder="Password"
                    required
                    disabled={isLoading || inputsDisabled}
                  />
                </div>
              </div>
              <Button
                variant="secondary"
                type="submit"
                disabled={isLoading || inputsDisabled}
                className="w-full px-4 py-2 text-center text-base font-semibold transition duration-200 ease-in focus:outline-hidden focus:ring-2 disabled:opacity-50"
              >
                {isLoading ? submittingLabel : submitLabel}
              </Button>
            </form>
            <div className="py-12 text-center">{footer}</div>
          </div>
        </div>
        <div className="relative hidden h-screen w-1/2 shadow-2xl md:block">
          <div className="left-0 top-0 flex h-screen w-full items-center justify-center bg-surface-strong object-cover ease-in-out">
            <span className="text-content-muted">AnthoLume</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function authFormFooter(
  primaryLink: { to: string; text: string },
  showPrimary: boolean
) {
  return (
    <>
      {showPrimary && (
        <p>
          <Link to={primaryLink.to} className="font-semibold underline">
            {primaryLink.text}
          </Link>
        </p>
      )}
      <p className={showPrimary ? 'mt-4' : ''}>
        <a href="/local" className="font-semibold underline">
          Offline / Local Mode
        </a>
      </p>
    </>
  );
}
