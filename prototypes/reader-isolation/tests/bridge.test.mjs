import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({entryPoints: ['src/bridge.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {validObservation, validCommand, trustedObservation} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const nonce = 'a'.repeat(32);
const boot = {type:'boot',nonce,origin:'null',parentDOM:false,storage:false,cookie:false};
test('only exact typed observations, never parent commands', () => {
 assert.equal(validObservation(boot,nonce),true);
 for(const value of [null, [], {...boot,api:'/api/delete'}, {...boot,nonce:'b'.repeat(32)}, {...boot,parentDOM:true}, {type:'fetch',nonce,url:'/api'}, {type:'codec',nonce,path:'x',ok:true,cfi:'',extra:1}]) assert.equal(validObservation(value,nonce),false);
});
test('source and null origin are independently required', () => {
 const source={}; const event={source,origin:'null',data:boot};
 assert.equal(trustedObservation(event,source,nonce),true);
 assert.equal(trustedObservation(event,{},nonce),false);
 assert.equal(trustedObservation({...event,origin:'http://app'},source,nonce),false);
 assert.equal(trustedObservation(event,null,nonce),false);
});
test('commands are bytes once or bounded codec strings, no fetch/navigation RPC', () => {
 assert.equal(validCommand({type:'open',nonce,bytes:new ArrayBuffer(10)},nonce),true);
 for(const value of [{type:'open',nonce,bytes:new ArrayBuffer(0)},{type:'open',nonce,bytes:new ArrayBuffer(8*1024*1024+1)},{type:'codec',nonce,path:'x'.repeat(2049)},{type:'fetch',nonce,url:'/'},{type:'codec',nonce,path:'x',url:'/'}]) assert.equal(validCommand(value,nonce),false);
});
