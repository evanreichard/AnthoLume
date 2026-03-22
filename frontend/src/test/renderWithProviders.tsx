import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ToastContext';

interface RenderWithProvidersOptions {
  route?: string;
  queryClient?: QueryClient;
  withQueryClient?: boolean;
  withToastProvider?: boolean;
}

interface RenderWithProvidersWrapperProps {
  children: ReactNode;
  route: string;
  queryClient: QueryClient;
  withQueryClient: boolean;
  withToastProvider: boolean;
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function RenderWithProvidersWrapper({
  children,
  route,
  queryClient,
  withQueryClient,
  withToastProvider,
}: RenderWithProvidersWrapperProps) {
  let content = <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>;

  if (withQueryClient) {
    content = <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>;
  }

  if (withToastProvider) {
    content = <ToastProvider>{content}</ToastProvider>;
  }

  return content;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    queryClient = createTestQueryClient(),
    withQueryClient = true,
    withToastProvider = false,
  }: RenderWithProvidersOptions = {}
) {
  return {
    ui,
    wrapper: ({ children }: { children: ReactNode }) => (
      <RenderWithProvidersWrapper
        route={route}
        queryClient={queryClient}
        withQueryClient={withQueryClient}
        withToastProvider={withToastProvider}
      >
        {children}
      </RenderWithProvidersWrapper>
    ),
    queryClient,
  };
}
