import { test, expect } from '@playwright/test';

test('dispose while original-byte fetch is pending prevents transfer, late observations and retained frame/listener', async ({ page }) => {
  let release!:()=>void; const gate=new Promise<void>(resolve=>{release=resolve});
  let requested=0;
  await page.route('**/fixtures/benign.epub',async route=>{requested++;await gate;await route.fulfill({status:200,contentType:'application/epub+zip',body:Buffer.alloc(32)}).catch(()=>{})});
  await page.goto('/');
  await expect.poll(()=>requested).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).proof?.observations.some((v:any)=>v.type==='boot'))).toBe(true);
  await page.evaluate(()=>(window as any).proof.mount(false));
  await expect(page.locator('iframe')).toHaveCount(0);
  const before=await page.evaluate(()=>(window as any).proof.observations.length);
  release();
  await page.waitForTimeout(200);
  expect(await page.evaluate(()=>(window as any).proof.observations.length)).toBe(before);
  expect(await page.evaluate(()=>({frames:(window as any).proof.lifecycle.frames,listeners:(window as any).proof.lifecycle.listeners}))).toEqual({frames:0,listeners:0});
  expect(page.frames()).toHaveLength(1);
});

test('request allowlist sees arbitrary-host and application-path sentinel attempts before network', async ({ page }) => {
  const attempts:string[]=[];
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin==='http://127.0.0.1:5318'&&['/','/app.js','/viewer.js','/fixtures/benign.epub'].includes(url.pathname)&&route.request().frame()===page.mainFrame()) return route.continue();
    if(['data:','blob:','about:'].includes(url.protocol))return route.continue();
    attempts.push(url.href);return route.abort();
  });
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as any).proof?.observations.some((v:any)=>v.type==='render'))).toBe(true);
  expect(attempts).toEqual([]);
  await page.evaluate(async()=>{await Promise.allSettled([fetch('https://unlisted.sentinel.invalid/ping'),fetch('/api/sentinel')])});
  expect(attempts.sort()).toEqual(['http://127.0.0.1:5318/api/sentinel','https://unlisted.sentinel.invalid/ping']);
});
