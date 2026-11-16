import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const origin = 'http://127.0.0.1:5318';
async function monitor(page: Page) {
  const attempts: string[] = [];
  const allowed = new Set(['/', '/app.js', '/viewer.js', '/fixtures/benign.epub', '/fixtures/scripts.epub', '/fixtures/outbound.epub', '/fixtures/alice.epub', '/fixtures/active-navigation.epub']);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['blob:', 'data:', 'about:'].includes(url.protocol)) return route.continue();
    if (route.request().frame() === page.mainFrame() && url.origin === origin && allowed.has(url.pathname) && route.request().method() === 'GET') return route.continue();
    attempts.push(route.request().url()); return route.abort();
  });
  return attempts;
}
async function ready(page: Page, fixture = 'benign') {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!(window as any).proof?.reader)).toBe(true);
  if (fixture !== 'benign') {
    const oldNonce = await page.evaluate(() => (window as any).proof.reader.nonce);
    await page.evaluate(name => (window as any).proof.fixture(name), fixture);
    await expect.poll(() => page.evaluate(() => (window as any).proof.reader?.nonce)).not.toBe(oldNonce);
  }
  await expect.poll(() => page.evaluate(() => (window as any).proof.observations.some((v: any) => v.type === 'render' && v.nonce === (window as any).proof.reader.nonce))).toBe(true);
  const outer = page.frames().find(f => f.parentFrame() === page.mainFrame() && f.url() === 'about:srcdoc')!;
  await expect.poll(() => outer.evaluate(() => (window as any).evidence?.render)).toBe('passive-frame-dom-unavailable');
  return outer;
}

test('bundled real EPUB.js reaches the inaccessible passive document; KO parses unchanged original bytes inside opaque viewer', async ({ page }, info) => {
  const attempts = await monitor(page);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const outer = await ready(page);
  const evidence = await outer.evaluate(() => (window as any).evidence);
  const observations = await page.evaluate(() => (window as any).proof.observations);
  const identity = observations.find((v: any) => v.type === 'identity');
  const bytes = await readFile('public/fixtures/benign.epub');
  expect(identity.full).toBe(createHash('md5').update(bytes).digest('hex'));
  expect(evidence.engineAttempted).toBe(true);
  expect(evidence.chapters[0].cspFirst).toBe(true);
  const originalChapter = await (await JSZip.loadAsync(bytes)).file('OPS/one.xhtml')!.async('string');
  const originalBody = await outer.evaluate(source => new DOMParser().parseFromString(source, 'application/xhtml+xml').body.outerHTML, originalChapter);
  expect(evidence.chapters[0].body).toBe(originalBody);
  expect(evidence.renderedCodec).toBeUndefined();
  expect(evidence.childDocument).toBe(false);
  expect(evidence.frameSandbox).toBe('allow-same-origin');
  expect(evidence.codec[0]).toMatchObject({ok:true,original:'/body/DocFragment[1]/body'});
  expect(evidence.roundTrip).toEqual({path:'/body/DocFragment[1]/body/div[1]/p[1]',same:true});
  expect(errors.some(s => s.includes("body"))).toBe(true);
  expect(await page.locator('iframe[data-viewer]').getAttribute('sandbox')).toBe('allow-scripts');
  expect(await outer.evaluate(() => self.origin)).toBe('null');
  expect(attempts).toEqual([]);
  await info.attach('engine-evidence', {body:JSON.stringify({evidence,observations,errors},null,2),contentType:'application/json'});
});

test('benign chapter parses but remains hidden and ordinary internal navigation cannot reach its target', async ({ page }, info) => {
  const attempts = await monitor(page); const outer = await ready(page);
  const child = outer.childFrames()[0];
  await expect(child.locator('#target')).toBeAttached();
  await expect(child.locator('#target')).toBeHidden();
  const styles = await child.locator('#target').evaluate(async element => {
    await document.fonts.ready;
    const style = getComputedStyle(element);
    return { color:style.color,border:style.borderTopWidth,font:document.fonts.check('16px ProofLato'),loaded:[...document.fonts].map(f=>({family:f.family,status:f.status})),svg:(document.querySelector('#packaged-svg') as HTMLImageElement).naturalWidth,inlineSVG:!!document.querySelector('svg rect') };
  });
  expect(styles).toMatchObject({color:'rgb(12, 34, 56)',svg:80,inlineSVG:true});
  expect(attempts).toEqual([]);
  // Compatibility Failure - Automation can activate the hidden anchor, but the engine cannot handle the ordinary internal link.
  await child.locator('#internal').evaluate((element: HTMLElement) => element.click());
  await page.waitForTimeout(200);
  expect(attempts).toEqual([]);
  expect(await child.locator('#second').count()).toBe(0);
  await info.attach('benign-styles-and-link-blocker',{body:JSON.stringify({styles,attempts},null,2),contentType:'application/json'});
});

test('public Alice uses exact protocol identity and real opaque codec, but same renderer blocker', async ({ page }) => {
  const attempts=await monitor(page); const outer=await ready(page,'alice');
  await expect.poll(() => outer.evaluate(() => (window as any).evidence?.codec?.[0]?.ok)).toBe(true);
  const identity = await page.evaluate(() => (window as any).proof.observations.filter((v:any)=>v.type==='identity').at(-1));
  expect(identity).toMatchObject({partial:'386d1cb51fe4a72e5c9fdad5e059bad9',full:'0f36c66155de34b281c4791654d0b1ce',bytes:1402237});
  expect(attempts).toEqual([]);
});

for(const fixture of ['scripts','outbound']) test(`${fixture}: passive book cannot run scripts, obtain app DOM/storage, forge viewer messages or load forbidden subresources`, async ({ page }) => {
  const attempts=await monitor(page);
  await page.addInitScript(() => { (window as any).bookMessages=[]; window.addEventListener('message',event=>{if(event.data?.type==='book-script-ran')(window as any).bookMessages.push(event.data)}); });
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('credential','synthetic-secret'); document.body.dataset.credential='synthetic-dom'; document.cookie='proof=synthetic-cookie; SameSite=Strict'; });
  await expect.poll(() => page.evaluate(() => !!(window as any).proof?.reader)).toBe(true);
  await page.evaluate(name=>(window as any).proof.fixture(name),fixture);
  await expect.poll(()=>page.evaluate(()=>(window as any).proof.observations.some((v:any)=>v.type==='render'&&v.nonce===(window as any).proof.reader.nonce))).toBe(true);
  const outer=page.frames().find(f=>f.parentFrame()===page.mainFrame()&&f.url()==='about:srcdoc')!;
  await expect.poll(()=>outer.childFrames().length).toBe(1);
  await page.waitForTimeout(200);
  expect(await outer.childFrames()[0].evaluate(() => (window as any).bookRan)).toBeUndefined();
  expect(await page.evaluate(() => ({credential:localStorage.getItem('credential'),pwned:document.body.dataset.pwned,messages:(window as any).bookMessages}))).toEqual({credential:'synthetic-secret',pwned:undefined,messages:[]});
  expect(attempts).toEqual([]);
});

test('source, nonce, exact shapes reject book/sibling/stale messages, no arbitrary parent command surface', async ({ page }) => {
  await monitor(page); const outer=await ready(page);
  const nonce=await page.evaluate(()=>(window as any).proof.reader.nonce);
  const before=await page.evaluate(()=>(window as any).proof.lifecycle.accepted);
  await outer.childFrames()[0].evaluate(nonce => {
    // Automation Bypass - This sends a known-valid observation from the hostile source even though book scripts are disabled.
    top!.postMessage({type:'codec',nonce,path:'/body/DocFragment[1]/body',ok:true,cfi:'forged'},'*');
  },nonce);
  await outer.evaluate(nonce=>{
    parent.postMessage({type:'fetch',nonce,url:'/api/steal'},'*');
    parent.postMessage({type:'codec',nonce,path:'x',ok:true,cfi:'',extra:true},'*');
    parent.postMessage({type:'codec',nonce:'b'.repeat(32),path:'x',ok:true,cfi:''},'*');
  },nonce);
  await page.waitForTimeout(100);
  expect(await page.evaluate(()=>(window as any).proof.lifecycle.accepted)).toBe(before);
  await page.evaluate(()=> (window as any).proof.reader.codec('/body/DocFragment[1]/body/div[1]/p[1]'));
  await expect.poll(()=>page.evaluate(()=>(window as any).proof.lifecycle.accepted)).toBe(before+1);
  const commandBefore=await outer.evaluate(()=>(window as any).evidence.acceptedCommands);
  await page.evaluate(()=>{const r=(window as any).proof.reader;r.frame.contentWindow.postMessage({type:'fetch',nonce:r.nonce,url:'/api/steal'},'*');r.frame.contentWindow.postMessage({type:'codec',nonce:r.nonce,path:'x',extra:true},'*')});
  await page.waitForTimeout(100);
  expect(await outer.evaluate(()=>(window as any).evidence.acceptedCommands)).toBe(commandBefore);
});

test('StrictMode and repeated realm removal release frames/listeners and suppress pending-open publication', async ({ page }) => {
  const attempts=await monitor(page);
  await page.addInitScript(() => {
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options: any) => { if(type==='message') listeners.add(listener); add(type,listener,options); }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options: any) => { if(type==='message') listeners.delete(listener); remove(type,listener,options); }) as typeof window.removeEventListener;
    (window as any).watchedMessageListeners = listeners;
  });
  await ready(page);
  expect(await page.evaluate(() => (window as any).watchedMessageListeners.size)).toBe(1);
  expect(await page.evaluate(async () => { try { await (window as any).proof.reader.open(new ArrayBuffer(1)); return 'bad'; } catch { return 'single-use'; } })).toBe('single-use');
  const first=await page.evaluate(()=>(window as any).proof.lifecycle);
  const development = process.env.M2_PRODUCTION !== '1';
  expect(first.created).toBe(development ? 2 : 1); expect(first.disposed).toBe(development ? 1 : 0); expect(first.frames).toBe(1); expect(first.listeners).toBe(1);
  for(let i=0;i<3;i++){
    await page.evaluate(() => { (window as any).staleViewer = {nonce:(window as any).proof.reader.nonce,source:(window as any).proof.reader.frame.contentWindow}; (window as any).proof.mount(false); });
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(page.frames()).toHaveLength(1);
    expect(await page.evaluate(() => (window as any).watchedMessageListeners.size)).toBe(0);
    expect(await page.evaluate(()=>({frames:(window as any).proof.lifecycle.frames,listeners:(window as any).proof.lifecycle.listeners}))).toEqual({frames:0,listeners:0});
    const count=await page.evaluate(()=>(window as any).proof.observations.length);
    await page.waitForTimeout(80);
    expect(await page.evaluate(()=>(window as any).proof.observations.length)).toBe(count);
    await page.evaluate(()=>(window as any).proof.mount(true));
    await expect.poll(()=>page.evaluate(()=>(window as any).proof.observations.length)).toBeGreaterThan(count);
    await expect.poll(() => page.evaluate(() => (window as any).proof.observations.some((v:any)=>v.type==='render'&&v.nonce===(window as any).proof.reader.nonce))).toBe(true);
    const accepted = await page.evaluate(() => (window as any).proof.lifecycle.accepted);
    await page.evaluate(() => { const old=(window as any).staleViewer; window.dispatchEvent(new MessageEvent('message',{origin:'null',source:old.source,data:{type:'codec',nonce:old.nonce,path:'old',ok:true,cfi:'old'}})); });
    expect(await page.evaluate(() => (window as any).proof.lifecycle.accepted)).toBe(accepted);
  }
  await page.evaluate(()=>{const r=(window as any).proof.reader;r.dispose();r.dispose()});
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(attempts).toEqual([]);
});
