import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminRoute } from './AdminRoute';
import { useAuth } from './AuthContext';

vi.mock('./AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

describe('AdminRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children for admin users', () => {
    mockedUseAuth.mockReturnValue({
      isAuthenticated: true,
      isCheckingAuth: false,
      user: { username: 'evan', is_admin: true },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <MemoryRouter>
        <AdminRoute>
          <div>Admin Panel</div>
        </AdminRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
  });

  it('redirects non-admin users to the home page', () => {
    mockedUseAuth.mockReturnValue({
      isAuthenticated: true,
      isCheckingAuth: false,
      user: { username: 'evan', is_admin: false },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <div>Admin Panel</div>
              </AdminRoute>
            }
          />
          <Route path="/" element={<div>Home Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });
});
