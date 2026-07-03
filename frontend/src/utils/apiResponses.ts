type ApiResponse = {
  status: number;
  data: unknown;
};

export function dataForStatus<TResponse extends ApiResponse, TStatus extends TResponse['status']>(
  response: TResponse | undefined,
  status: TStatus
): Extract<TResponse, { status: TStatus }>['data'] | undefined {
  return response?.status === status
    ? (response.data as Extract<TResponse, { status: TStatus }>['data'])
    : undefined;
}

export function dataForSuccess<TResponse extends ApiResponse>(
  response: TResponse | undefined
): Extract<TResponse, { status: 200 | 201 | 202 | 204 }>['data'] | undefined {
  return response && response.status >= 200 && response.status < 300
    ? (response.data as Extract<TResponse, { status: 200 | 201 | 202 | 204 }>['data'])
    : undefined;
}
