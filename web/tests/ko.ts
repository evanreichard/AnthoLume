import { createHash } from 'node:crypto';
import { expect } from './fixtures';

export async function ko(origin: string, user: string, fraction?: number) {
  const headers = {
    'x-auth-user': user,
    'x-auth-key': createHash('md5').update('synthetic-public-password').digest('hex'),
    'Content-Type': 'application/json',
  };
  const response = await fetch(`${origin}/api/ko/syncs/progress${fraction === undefined ? '/book_001' : ''}`, {
    method: fraction === undefined ? 'GET' : 'PUT',
    headers,
    ...(fraction === undefined
      ? {}
      : {
          body: JSON.stringify({
            document: 'book_001',
            percentage: fraction,
            progress: `/body/DocFragment[1]/body/p[${fraction > 0.8 ? 30 : 20}]`,
            device: 'Actual KO wire test',
            device_id: `ko-${user}`,
          }),
        }),
  });
  expect(response.status).toBe(200);
  return response.json();
}
