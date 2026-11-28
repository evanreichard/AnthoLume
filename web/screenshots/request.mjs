import { expect } from '@playwright/test';

export async function openReleasePicker(page, origin, doc) {
  const book = {
    provider: 'hardcover',
    id: '69589',
    title: doc.title,
    author: 'H. G. Wells',
    year: 1895,
    description: doc.description,
    has_cover: true,
    request_count: 0,
  };
  const epub = {
    key: 'epub',
    source: 'prowlarr',
    indexer: 'Book Index',
    title: `${book.title} [EPUB]`,
    author: book.author,
    format: 'epub',
    language: 'en',
    size: '410 KB',
    selection: 'demo-epub',
  };
  const illustrated = {
    ...epub,
    key: 'illustrated',
    title: `${book.title} (Illustrated Edition)`,
    format: 'pdf',
    size: '2.4 MB',
    selection: 'demo-pdf',
  };
  await page.route('**/api/v1/shelfmark/settings', (route) =>
    route.fulfill({ json: { enabled: true, configured: true } }),
  );
  await page.route('**/api/v1/shelfmark/requests', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/shelfmark/search?*', (route) => route.fulfill({ json: [book] }));
  await page.route('**/api/v1/shelfmark/cover?*', async (route) => {
    const response = await page.request.get(`${origin}/api/v1/documents/${doc.id}/cover`);
    await route.fulfill({ response });
  });
  await page.route('**/api/v1/shelfmark/releases?*', (route) =>
    route.fulfill({
      json: {
        releases: [epub, illustrated],
        partial: false,
        recommendation: { release_key: epub.key, basis: 'title_author' },
      },
    }),
  );
  await page.goto(origin + '/request');
  await page.getByRole('searchbox', { name: 'Search Books to Request' }).fill(book.title);
  await page.getByRole('button', { name: 'Search Books', exact: true }).click();
  await page
    .getByRole('group', { name: 'Search Results' })
    .getByRole('button', { name: /The Time Machine/ })
    .click();
  const dialog = page.getByRole('dialog', { name: book.title });
  const first = dialog.getByRole('listitem').first();
  await expect(first.getByRole('button', { name: 'Recommended' })).toBeInViewport();
  await expect(first.getByRole('button', { name: `Download ${epub.title}` })).toBeEnabled();
  await expect(dialog.getByText(illustrated.title)).toBeInViewport();
  await dialog.locator('img').evaluate((cover) => cover.decode());
}
