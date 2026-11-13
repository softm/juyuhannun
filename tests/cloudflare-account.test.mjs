import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNT_ORIGIN,ACCOUNT_SITE,validAuthorizationMessage,createCloudflareAccount,getAvailableProviders} from '../public/js/cloudflare-account.js';

test('Cloudflare login uses registered shared account and site id',()=>{
  assert.equal(ACCOUNT_SITE,'juyuhannun');
  assert.equal(ACCOUNT_ORIGIN,'https://softm-hannun-account.softm.workers.dev');
});

test('OAuth popup response must match source, origin, request and one-use code shape',()=>{
  const popup={id:'expected'};
  const base={source:popup,origin:ACCOUNT_ORIGIN,data:{type:'softm:authorization',requestId:'request-1',code:'a'.repeat(43)}};
  assert.equal(validAuthorizationMessage(base,popup,'request-1'),true);
  assert.equal(validAuthorizationMessage({...base,origin:'https://attacker.example'},popup,'request-1'),false);
  assert.equal(validAuthorizationMessage({...base,source:{}},popup,'request-1'),false);
  assert.equal(validAuthorizationMessage({...base,data:{...base.data,requestId:'another'}},popup,'request-1'),false);
  assert.equal(validAuthorizationMessage({...base,data:{...base.data,code:'invalid'}},popup,'request-1'),false);
  assert.equal(validAuthorizationMessage({...base,data:{...base.data,type:'wrong'}},popup,'request-1'),false);
});

test('session-scoped login restores current user but does not trust an expired token',()=>{
  const key='softm-cloudflare:juyuhannun:softm-hannun-account.softm.workers.dev';
  const data=new Map();
  const original=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  try{
    data.set(key,JSON.stringify({token:'z'.repeat(43),uid:'test-uid',displayName:'테스터',expiresAt:Date.now()+60000}));
    assert.equal(createCloudflareAccount().currentUser.displayName,'테스터');
    data.set(key,JSON.stringify({token:'z'.repeat(43),uid:'test-uid',expiresAt:Date.now()-1000}));
    assert.equal(createCloudflareAccount().currentUser,null);
    assert.equal(data.has(key),false);
  }finally{if(original===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=original;}
});

test('provider status is controlled by Worker health, never presumed enabled',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.equal(url,ACCOUNT_ORIGIN+'/health');
    return {ok:true,json:async()=>({ok:true,providers:{google:true,kakao:false,naver:false},registrationLocked:false})};
  };
  try{
    assert.deepEqual(await getAvailableProviders(),{google:true,kakao:false,naver:false,registrationLocked:false});
  }finally{globalThis.fetch=original;}
});
