import { test, expect } from '@playwright/test';

test('real engine restores bare body and KO omitted-anchor image suffix without publishing fallbacks', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const p = window.proof, bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    const paths = ['/body/DocFragment[1]/body', '/body/DocFragment[1]/body/div[1]/p[2]/img.0'];
    const restored: { state: string; ko?: string; visible: boolean }[] = [];
    let published = 0;
    for (const path of paths) {
      const host = document.createElement('div'); host.style.cssText = 'height:480px;width:700px'; document.body.appendChild(host);
      let status: { state: string; location?: { ko: string } } = { state: 'opening' };
      const reader = new p.ReaderController(host, value => { status = value; }, async () => { published++; });
      await reader.open(bytes, path);
      const frame = host.querySelector('iframe')!;
      const element = p.elementFromKO(frame.contentDocument!, path);
      const visible = Array.from(element.getClientRects()).some(rect => rect.right > 0 && rect.left < frame.clientWidth && rect.bottom > 0 && rect.top < frame.clientHeight);
      restored.push({ state: status.state, ko: status.location?.ko, visible });
      await reader.dispose(); host.remove();
    }
    return { restored, published };
  });
  expect(result).toEqual({ restored: [
    { state: 'ready', ko: '/body/DocFragment[1]/body', visible: true },
    { state: 'ready', ko: '/body/DocFragment[1]/body/div[1]/p[2]/img.0', visible: true }
  ], published: 0 });
});
