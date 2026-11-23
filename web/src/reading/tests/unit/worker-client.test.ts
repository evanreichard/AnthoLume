import { afterEach, expect, test, vi } from 'vitest';
import { OfflineShellError, WorkerCoordinator } from '../../worker-client';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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

  await worker.connect();
  expect(worker.error).toBeNull();
  expect(states).toEqual(['error', 'idle']);
  expect(getRegistration).toHaveBeenCalledWith(root);
});

test('a registration failure requested only by Save to Device returns to its caller without publishing recovery', async () => {
  const root = 'https://reader.example/';
  vi.stubEnv('DEV', false);
  vi.stubGlobal('location', { href: `${root}app/` });
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => { throw new Error('registration failed'); } } });
  const states: (string | null)[] = [];
  const worker = new WorkerCoordinator(() => { states.push(worker.error); });

  const checking = worker.ensureOfflineShell(new AbortController().signal);
  await expect(checking).rejects.toBeInstanceOf(OfflineShellError);
  await expect(checking).rejects.toThrow('Could not prepare the offline app. Check your connection and try again.');
  expect(worker.error).toBeNull();
  expect(states).toEqual([]);
});
