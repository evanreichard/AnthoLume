import { test, expect } from '@playwright/test';

const appOrigin = 'http://127.0.0.1:5318';
test('Chromium origin matrix: inherited sandbox-origin restriction creates distinct child origins', async ({ page }, info) => {
  await page.goto('/');
  const matrix = await page.evaluate(async () => {
    const results = [];
    for (const kind of ['srcdoc', 'blank', 'write', 'unsandboxed', 'data']) {
      const result = await new Promise(resolve => {
        const outer = document.createElement('iframe');
        outer.sandbox.value = kind === 'data' ? 'allow-scripts allow-same-origin' : 'allow-scripts';
        const receive = (event: MessageEvent) => {
          if (event.source !== outer.contentWindow || event.data?.type !== 'origin-probe') return;
          window.removeEventListener('message', receive); outer.remove(); resolve(event.data);
        };
        window.addEventListener('message', receive);
        const html = `<body><script>const kind=${JSON.stringify(kind)};const f=document.createElement('iframe');if(kind!=='unsandboxed')f.sandbox='allow-same-origin';f.onload=()=>{let access=!!f.contentDocument,write=false;if(kind==='write')try{f.contentDocument.write('<p>written</p>');write=true}catch(e){}parent.postMessage({type:'origin-probe',kind,access,write,origin:self.origin},'*')};if(['srcdoc','unsandboxed','data'].includes(kind))f.srcdoc='<p>nested</p>';document.body.append(f);<\/script>`;
        if (kind === 'data') outer.src = 'data:text/html;base64,' + btoa(html); else outer.srcdoc = html;
        document.body.append(outer);
      }); results.push(result);
    }
    return results;
  });
  expect(matrix).toEqual(['srcdoc','blank','write','unsandboxed','data'].map(kind=>({type:'origin-probe',kind,access:kind==='data',write:false,origin:'null'})));
  await info.attach('origin-matrix',{body:JSON.stringify(matrix,null,2),contentType:'application/json'});
});

test('rejected data-origin control renders EPUB styles/assets/DOM codec, fails stock internal links, and can restore app origin', async ({ page }, info) => {
  const attempts: string[] = [];
  await page.route('**/*', route => {
    const url=new URL(route.request().url());
    if (url.origin === appOrigin && ['/', '/app.js', '/viewer.js', '/fixtures/benign.epub', '/credential-target.html'].includes(url.pathname)) return route.continue();
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return route.continue();
    attempts.push(url.href);return route.abort();
  });
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as any).proof?.reader?.frame.srcdoc?.length || 0)).toBeGreaterThan(10000);
  await page.evaluate(async () => {
    const reader=(window as any).proof.reader;
    const html=reader.frame.srcdoc; const nonce=reader.nonce; reader.dispose();
    localStorage.setItem('credential','synthetic-secret');
    (window as any).navigationProbes=[];
    window.addEventListener('message',event=>{if(event.data?.type==='navigation-probe')(window as any).navigationProbes.push(event.data)});
    const frame=document.createElement('iframe');frame.id='rejected-data-control';
    frame.title='Rejected data control'; frame.sandbox.value='allow-scripts allow-same-origin';frame.style.cssText='width:950px;height:700px';
    const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
    frame.src='data:text/html;base64,'+btoa(unescape(encodeURIComponent(html)));document.body.append(frame);
    await loaded;
    const bytes=await fetch('/fixtures/benign.epub').then(r=>r.arrayBuffer());
    frame.contentWindow!.postMessage({type:'open',nonce,bytes},'*',[bytes]);
  });
  const frame=page.frames().find(f=>f.url().startsWith('data:text/html'))!;
  await expect.poll(()=>frame.childFrames().length).toBe(1);
  const chapter=frame.childFrames()[0];
  await expect(chapter.locator('#target')).toBeVisible();
  const assets=await chapter.locator('#target').evaluate(async el=>{
    await document.fonts.ready; const css=getComputedStyle(el);
    return {color:css.color,border:css.borderTopWidth,font:[...document.fonts].some(f=>f.family==='ProofLato'&&f.status==='loaded'),svg:(document.querySelector('#packaged-svg') as HTMLImageElement).naturalWidth,inlineSVG:!!document.querySelector('svg rect')};
  });
  expect(assets).toEqual({color:'rgb(12, 34, 56)',border:'3px',font:true,svg:80,inlineSVG:true});
  expect(await frame.evaluate(()=>({origin:self.origin,roundTrip:(window as any).evidence.roundTrip}))).toEqual({origin:'null',roundTrip:{path:'/body/DocFragment[1]/body/div[1]/p[1]',same:true}});
  await page.screenshot({path:'../../_scratch/m2/reader-isolation/rejected-data-render.png'});
  expect(await frame.evaluate(()=>(window as any).evidence.renderedCodec)).toEqual({path:'/body/DocFragment[1]/body/div[1]/p[1]',same:true});
  await chapter.locator('#internal').click();
  await expect.poll(()=>frame.evaluate(()=>(window as any).evidence.errors.some((s:string)=>s.includes('No Section Found')))).toBe(true);
  expect(await chapter.locator('#second').count()).toBe(0);
  expect(attempts).toEqual([]);
  // Rejected Control - Intrinsic data: opacity is lost on ordinary self-navigation when allow-same-origin is present.
  await frame.evaluate(url=>{location.href=url},appOrigin+'/credential-target.html');
  await expect.poll(()=>page.evaluate(()=>(window as any).navigationProbes.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).navigationProbes[0])).toEqual({type:'navigation-probe',access:true,origin:appOrigin});
  expect(await page.evaluate(()=>({credential:localStorage.getItem('credential'),pwned:document.body.dataset.pwned}))).toEqual({credential:'stolen',pwned:'yes'});
  await info.attach('rejected-data-control',{body:JSON.stringify({assets,attempts,decision:'reject: origin restored by self-navigation'},null,2),contentType:'application/json'});
});

test('preferred sandbox remains opaque even after same-origin self-navigation; child cannot remove the outer sandbox', async ({ page }) => {
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as any).proof?.observations.some((v:any)=>v.type==='boot'))).toBe(true);
  const frame=page.frames().find(f=>f.parentFrame()===page.mainFrame()&&f.url()==='about:srcdoc')!;
  expect(await frame.evaluate(()=>({origin:self.origin,frameElement:window.frameElement}))).toEqual({origin:'null',frameElement:null});
  await page.evaluate(()=>{(window as any).navigationProbes=[];window.addEventListener('message',event=>{if(event.data?.type==='navigation-probe')(window as any).navigationProbes.push(event.data)})});
  await frame.evaluate(url=>{location.href=url},appOrigin+'/credential-target.html');
  await expect.poll(()=>page.evaluate(()=>(window as any).navigationProbes.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).navigationProbes[0])).toEqual({type:'navigation-probe',access:false,origin:'null'});
  expect(await page.locator('iframe[data-viewer]').getAttribute('sandbox')).toBe('allow-scripts');
});

test('passive sandbox blocks automatic meta navigation without outbound requests in the bounded hostile fixture', async ({ page }, info) => {
  const attempts: string[]=[];
  const consoleMessages: string[]=[]; page.on('console',message=>consoleMessages.push(message.text()));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===appOrigin&&['/','/app.js','/viewer.js','/fixtures/benign.epub','/fixtures/active-navigation.epub'].includes(url.pathname))return route.continue();
    if(['data:','blob:','about:'].includes(url.protocol))return route.continue();
    attempts.push(url.href);return route.abort();
  });
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!(window as any).proof?.reader)).toBe(true);
  await page.evaluate(()=>(window as any).proof.fixture('active-navigation'));
  await expect.poll(()=>page.evaluate(()=>(window as any).proof.observations.some((v:any)=>v.type==='render'&&v.nonce===(window as any).proof.reader.nonce))).toBe(true);
  await page.waitForTimeout(300);
  expect(attempts).toEqual([]);
  expect(consoleMessages.some(message=>message.toLowerCase().includes('refresh'))).toBe(true);
  await info.attach('passive-meta-navigation',{body:JSON.stringify({attempts,consoleMessages},null,2),contentType:'application/json'});
});
