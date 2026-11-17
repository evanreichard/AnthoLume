export {};
const host = globalThis as unknown as { onmessage: (event: MessageEvent<ArrayBuffer>) => void };
host.onmessage = () => {};
