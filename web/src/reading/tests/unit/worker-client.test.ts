import { afterEach, expect, test, vi } from 'vitest';
import { WorkerCoordinator } from '../../worker-client';

afterEach(() => vi.unstubAllGlobals());

test('an update failure without an active shell shows recovery until retry succeeds', async () => {
  const root = 'https://reader.example/';
  let fail!: (error: Error) => void;
  const firstCheck = new Promise<void>((_, reject) => { fail = reject; });
  const update = vi.fn<() => Promise<void>>().mockReturnValueOnce(firstCheck).mockResolvedValueOnce(undefined);
  const getRegistration = vi.fn(async () => ({ scope: root, installing: { scriptURL: `${root}sw.js` }, update }));
  vi.stubGlobal('location', { href: `${root}app/` });
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { getRegistration } });
  const states: string[] = [];
  const worker = new WorkerCoordinator(() => { states.push(worker.error ? 'error' : 'idle'); });

  await worker.start();
  expect(worker.error).toBeNull();
  const checking = worker.connect();
  fail(new Error('offline'));
  await checking;
  expect(worker.error).toContain('You can still read online');

  await worker.apply();
  expect(worker.error).toBeNull();
  expect(states).toEqual(['error', 'idle']);
  expect(getRegistration).toHaveBeenCalledWith(root);
});
