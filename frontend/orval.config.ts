import { defineConfig } from 'orval';

export default defineConfig({
  antholume: {
    output: {
      mode: 'split',
      baseUrl: '/api/v1',
      target: 'src/generated',
      schemas: 'src/generated/model',
      client: 'react-query',
      mock: false,
      override: {
        useQuery: true,
        mutations: true,
      },
    },
    input: {
      target: '../api/v1/openapi.yaml',
    },
  },
});