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
