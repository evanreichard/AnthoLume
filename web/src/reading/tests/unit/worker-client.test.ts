import { afterEach, expect, test, vi } from 'vitest';
import { WorkerCoordinator } from '../../worker-client';

afterEach(() => vi.unstubAllGlobals());

test('shell update failure is non-blocking and a successful retry clears recovery', async () => {
  const root = 'https://reader.example/';
  let fail!: (error: Error) => void;
  const firstCheck = new Promise<void>((_, reject) => { fail = reject; });
  const update = vi.fn<() => Promise<void>>().mockReturnValueOnce(firstCheck).mockResolvedValueOnce(undefined);
  const getRegistration = vi.fn(async () => ({ scope: root, active: { scriptURL: `${root}sw.js` }, update }));
  vi.stubGlobal('location', { href: `${root}app/` });
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { getRegistration } });
  const states: string[] = [];
  const worker = new WorkerCoordinator(() => { states.push(worker.update); });

  await worker.start();
  expect(worker.update).toBe('idle');
  const checking = worker.connect();
  fail(new Error('offline'));
  await checking;
  expect(worker.update).toBe('error');
  expect(worker.error).toContain('Reading and saving are still available');

  await worker.apply();
  expect(worker.error).toBeNull();
  expect(states).toEqual(['error', 'idle']);
  expect(getRegistration).toHaveBeenCalledWith(root);
});
