import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/ToastContext';
import { ThemeProvider, initializeThemeMode } from './theme/ThemeProvider';
import App from './App';
import { ApiError } from './utils/apiFetch';
import './index.css';

initializeThemeMode();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      // 4xx responses are deterministic (e.g. /auth/me 401 when logged out); only retry transient
      // network/5xx failures.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) {
          return false;
        }
        return failureCount < 1;
      },
    },
    mutations: {
      retry: 0,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
