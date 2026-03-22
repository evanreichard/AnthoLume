import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import RegisterPage from './RegisterPage';
import { useAuth } from '../auth/AuthContext';
import { useToasts } from '../components/ToastContext';
import { useGetInfo } from '../generated/anthoLumeAPIV1';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../components/ToastContext', () => ({
  useToasts: vi.fn(),
}));

vi.mock('../generated/anthoLumeAPIV1', () => ({
  useGetInfo: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseToasts = vi.mocked(useToasts);
const mockedUseGetInfo = vi.mocked(useGetInfo);

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedUseAuth.mockReturnValue({
      isAuthenticated: false,
      isCheckingAuth: false,
      user: null,
      login: vi.fn(),
      register: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn(),
    });

    mockedUseToasts.mockReturnValue({
      showToast: vi.fn(),
      showInfo: vi.fn(),
      showWarning: vi.fn(),
      showError: vi.fn(),
      removeToast: vi.fn(),
      clearToasts: vi.fn(),
    });

    mockedUseGetInfo.mockReturnValue({
      data: {
        status: 200,
        data: {
          registration_enabled: true,
        },
      },
      isLoading: false,
    } as ReturnType<typeof useGetInfo>);
  });

  it('submits the username and password to register', async () => {
    const user = userEvent.setup();
    const registerMock = vi.fn().mockResolvedValue(undefined);

    mockedUseAuth.mockReturnValue({
      isAuthenticated: false,
      isCheckingAuth: false,
      user: null,
      login: vi.fn(),
      register: registerMock,
      logout: vi.fn(),
    });

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText('Username'), 'evan');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith('evan', 'secret');
    });
  });

  it('shows a registration failed toast when registration fails while enabled', async () => {
    const user = userEvent.setup();
    const registerMock = vi.fn().mockRejectedValue(new Error('failed'));
    const showErrorMock = vi.fn();

    mockedUseAuth.mockReturnValue({
      isAuthenticated: false,
      isCheckingAuth: false,
      user: null,
      login: vi.fn(),
      register: registerMock,
      logout: vi.fn(),
    });

    mockedUseToasts.mockReturnValue({
      showToast: vi.fn(),
      showInfo: vi.fn(),
      showWarning: vi.fn(),
      showError: showErrorMock,
      removeToast: vi.fn(),
      clearToasts: vi.fn(),
    });

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText('Username'), 'evan');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalledWith('Registration failed');
    });
  });

  it('redirects to home when the user is already authenticated', async () => {
    mockedUseAuth.mockReturnValue({
      isAuthenticated: true,
      isCheckingAuth: false,
      user: { username: 'evan', is_admin: false },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('redirects to login when registration is disabled', async () => {
    mockedUseGetInfo.mockReturnValue({
      data: {
        status: 200,
        data: {
          registration_enabled: false,
        },
      },
      isLoading: false,
    } as ReturnType<typeof useGetInfo>);

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  it('disables the form when registration is disabled', () => {
    mockedUseGetInfo.mockReturnValue({
      data: {
        status: 200,
        data: {
          registration_enabled: false,
        },
      },
      isLoading: false,
    } as ReturnType<typeof useGetInfo>);

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );

    expect(screen.getByPlaceholderText('Username')).toBeDisabled();
    expect(screen.getByPlaceholderText('Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
  });
});
