export class APIUnavailable extends Error {}

type Observer = { epoch(): number; suspectOutage(): void };

export function createTransport(observer: Observer) {
  return async function send(request: Request, role: 'operation' | 'session-probe' = 'operation') {
    const epoch = observer.epoch();
    const report = () => {
      if (role === 'operation' && observer.epoch() === epoch) observer.suspectOutage();
    };
    let response: Response;
    try {
      response = await fetch(request);
    } catch (error) {
      const reason = request.signal.aborted ? request.signal.reason : error;
      const timeout = reason instanceof DOMException && reason.name === 'TimeoutError';
      if (!timeout && (request.signal.aborted || !(error instanceof TypeError))) throw error;
      report();
      throw new APIUnavailable(timeout ? 'The server request timed out.' : 'Could not reach the server.', { cause: error });
    }
    if (!request.signal.aborted && !response.redirected && [502, 503, 504].includes(response.status)) {
      if (role === 'session-probe') {
        void response.body?.cancel();
        throw new APIUnavailable(`Session service unavailable (HTTP ${response.status}).`);
      }
      report();
    }
    return response;
  };
}
