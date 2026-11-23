import { afterEach, expect, test, vi } from 'vitest';
import { APIUnavailable, createTransport } from './transport';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const observer = { epoch: vi.fn(() => 0), suspectOutage: vi.fn() };
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('fetch', fetch);
  return { observer, fetch, send: createTransport(observer) };
}
const request = (signal?: AbortSignal) => new Request('https://library.test/api/v1/test', { signal });

test('an operation retains its HTTP response; only gateway errors suggest a probe', async () => {
  const { observer, fetch, send } = setup();
  for (const status of [400, 401, 403, 404, 409, 500, 502, 503, 504]) {
    observer.suspectOutage.mockClear();
    const response = new Response('original response', { status });
    fetch.mockResolvedValueOnce(response);
    expect(await send(request())).toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(observer.suspectOutage).toHaveBeenCalledTimes(status >= 502 ? 1 : 0);
  }
});

test('network errors and deadlines report an outage, not caller cancellation or stale requests', async () => {
  const { observer, fetch, send } = setup();
  fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(send(request())).rejects.toBeInstanceOf(APIUnavailable);
  expect(observer.suspectOutage).toHaveBeenCalledTimes(1);

  const timedOut = AbortSignal.abort(new DOMException('Deadline exceeded', 'TimeoutError'));
  await expect(send(request(timedOut))).rejects.toBeInstanceOf(APIUnavailable);
  expect(observer.suspectOutage).toHaveBeenCalledTimes(2);

  observer.suspectOutage.mockClear();
  const cancelled = AbortSignal.abort();
  fetch.mockRejectedValueOnce(cancelled.reason);
  await expect(send(request(cancelled))).rejects.toBe(cancelled.reason);
  const stale = send(request());
  observer.epoch.mockReturnValue(1);
  await expect(stale).rejects.toBeInstanceOf(APIUnavailable);
  expect(observer.suspectOutage).not.toHaveBeenCalled();
});

test('body failures preserve deadline and cancellation semantics after headers', async () => {
  const { observer, fetch, send } = setup();
  for (const reason of [new DOMException('Cancelled', 'AbortError'), new DOMException('Expired', 'TimeoutError')]) {
    const controller = new AbortController();
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ pull(stream) {
      controller.abort(reason);
      stream.error(new TypeError('Connection reset'));
    } }), { headers: { 'Content-Type': 'application/problem+json' }, status: 400 }));
    const result = send(request(controller.signal), 'operation', 'json');
    if (reason.name === 'AbortError') await expect(result).rejects.toBe(reason);
    else await expect(result).rejects.toBeInstanceOf(APIUnavailable);
  }
  expect(observer.suspectOutage).toHaveBeenCalledTimes(1);
});

test('a failing session probe reports unavailability without starting another probe', async () => {
  const { observer, fetch, send } = setup();
  fetch.mockResolvedValueOnce(new Response(null, { status: 503 })).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(send(request(), 'session-probe')).rejects.toBeInstanceOf(APIUnavailable);
  await expect(send(request(), 'session-probe')).rejects.toBeInstanceOf(APIUnavailable);
  expect(observer.suspectOutage).not.toHaveBeenCalled();
});
