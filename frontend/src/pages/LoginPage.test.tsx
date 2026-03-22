import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
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

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedUseAuth.mockReturnValue({
      isAuthenticated: false,
      isCheckingAuth: false,
      user: null,
      login: vi.fn().mockResolvedValue(undefined),
      register: vi.fn(),
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
          registration_enabled: false,
        },
      },
    } as ReturnType<typeof useGetInfo>);
  });

  it('submits the username and password to login', async () => {
    const user = userEvent.setup();
    const loginMock = vi.fn().mockResolvedValue(undefined);

    mockedUseAuth.mockReturnValue({
      isAuthenticated: false,
      isCheckingAuth: false,
      user: null,
      login: loginMock,
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText('Username'), 'evan');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('evan', 'secret');
    });
  });

  it('shows a toast error when login fails', async () => {
    const user = userEvent.setup();
    const loginMock = vi.fn().mockRejectedValue(new Error('bad credentials'));
    const showErrorMock = vi.fn();

    mockedUseAuth.mockReturnValue({
      isAuthenticated: false,
      isCheckingAuth: false,
      user: null,
      login: loginMock,
      register: vi.fn(),
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
        <LoginPage />
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText('Username'), 'evan');
    await user.type(screen.getByPlaceholderText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalledWith('Invalid credentials');
    });
  });

  it('redirects when the user is already authenticated', async () => {
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
        <LoginPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('shows the registration link only when registration is enabled', () => {
    mockedUseGetInfo.mockReturnValue({
      data: {
        status: 200,
        data: {
          registration_enabled: true,
        },
      },
    } as ReturnType<typeof useGetInfo>);

    const { rerender } = render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Register here.' })).toBeInTheDocument();

    mockedUseGetInfo.mockReturnValue({
      data: {
        status: 200,
        data: {
          registration_enabled: false,
        },
      },
    } as ReturnType<typeof useGetInfo>);

    rerender(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: 'Register here.' })).not.toBeInTheDocument();
  });
});
