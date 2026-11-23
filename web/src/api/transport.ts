export class APIUnavailable extends Error {}

type Observer = { epoch(): number; suspectOutage(): void };

export function createTransport(observer: Observer) {
  return async function send(request: Request, role: 'operation' | 'session-probe' = 'operation', body: 'stream' | 'json' = 'stream') {
    const epoch = observer.epoch();
    const report = () => {
      if (role === 'operation' && observer.epoch() === epoch) observer.suspectOutage();
    };
    const failed = (error: unknown): never => {
      const reason = request.signal.aborted ? request.signal.reason : error;
      const timeout = reason instanceof DOMException && reason.name === 'TimeoutError';
      if (!timeout && (request.signal.aborted || !(error instanceof TypeError))) throw reason;
      report();
      throw new APIUnavailable(timeout ? 'The server request timed out.' : 'Could not reach the server.', { cause: error });
    };
    const response = await fetch(request).catch(failed);
    if (!request.signal.aborted && !response.redirected && [502, 503, 504].includes(response.status)) {
      if (role === 'session-probe') {
        void response.body?.cancel();
        throw new APIUnavailable(`Session service unavailable (HTTP ${response.status}).`);
      }
      report();
    }
    // JSON Transport - openapi-fetch consumes problem bodies internally. Finish the network read here so success and error bodies share the request's cancellation and outage rules.
    if (body === 'json' && !response.redirected && response.body && ['application/json', 'application/problem+json'].includes(response.headers.get('content-type')?.split(';')[0].trim() ?? '')) {
      const bytes = await response.arrayBuffer().catch(failed);
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return response;
  };
}
