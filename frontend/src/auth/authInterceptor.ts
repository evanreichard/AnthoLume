import axios, { type AxiosInstance } from 'axios';

const TOKEN_KEY = 'antholume_token';

let interceptorCleanup: (() => void) | null = null;

export function setupAuthInterceptors(axiosInstance: AxiosInstance = axios) {
  if (interceptorCleanup) {
    interceptorCleanup();
  }

  const requestInterceptorId = axiosInstance.interceptors.request.use(
    config => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    error => {
      return Promise.reject(error);
    }
  );

  const responseInterceptorId = axiosInstance.interceptors.response.use(
    response => {
      return response;
    },
    error => {
      if (error.response?.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
      }
      return Promise.reject(error);
    }
  );

  interceptorCleanup = () => {
    axiosInstance.interceptors.request.eject(requestInterceptorId);
    axiosInstance.interceptors.response.eject(responseInterceptorId);
  };

  return interceptorCleanup;
}

export { TOKEN_KEY };
export default axios;
