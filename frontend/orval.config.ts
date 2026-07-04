import { defineConfig } from 'orval';

export default defineConfig({
  antholume: {
    output: {
      mode: 'split',
      baseUrl: '/api/v1',
      target: 'src/generated',
      schemas: 'src/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      mock: false,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: './src/utils/apiFetch.ts',
          name: 'apiFetch',
        },
      },
    },
    input: {
      target: '../api/v1/openapi.yaml',
    },
  },
});