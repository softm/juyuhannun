// Cloudflare common identity only. Favorites and route history remain local to this device.
// Never use Firebase credentials, persistent localStorage or a third-party OAuth WebView.
export const ACCOUNT_ORIGIN='https://softm-hannun-account.softm.workers.dev';
export const ACCOUNT_SITE='juyuhannun';
const PROOF=/^[A-Za-z0-9_-]{43}$/;
const SESSION_KEY='softm-cloudflare:'+ACCOUNT_SITE+':softm-hannun-account.softm.workers.dev';

function proof(){
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function challenge(verifier){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function storedSession(){
  try{
    const data=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');
    if(data && PROOF.test(data.token) && typeof data.uid==='string' && data.uid.length<=128 &&
       Number.isFinite(data.expiresAt) && data.expiresAt>Date.now())return data;
    sessionStorage.removeItem(SESSION_KEY);
  }catch{try{sessionStorage.removeItem(SESSION_KEY);}catch{}}
  return null;
}
function saveSession(value){
  try{sessionStorage.setItem(SESSION_KEY,JSON.stringify(value));}catch{}
}
export function validAuthorizationMessage(event,popup,requestId){
  return event?.source===popup &&
    event?.origin===ACCOUNT_ORIGIN &&
    event?.data?.type==='softm:authorization' &&
    event?.data?.requestId===requestId &&
    PROOF.test(event?.data?.code||'');
}
export async function getAvailableProviders(){
  const response=await fetch(ACCOUNT_ORIGIN+'/health',{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Cloudflare 계정 서버가 응답하지 않습니다.');
  const value=await response.json();
  if(value?.ok!==true || !value.providers)throw Error('인증 제공자 설정을 확인할 수 없습니다.');
  return {
    google: value.providers.google===true,
    kakao: value.providers.kakao===true,
    naver: value.providers.naver===true,
    registrationLocked: value.registrationLocked===true
  };
}
export function createCloudflareAccount(){
  let auth=storedSession();
  const currentUser=()=>auth&&auth.expiresAt>Date.now()?{
    uid:auth.uid,
    displayName:auth.displayName||'한눈 계정',
    photoURL:auth.photoURL||null,
    provider:auth.provider||null
  }:null;

  // Caller invokes this directly from a user gesture. Open the popup before any await.
  async function login(provider=null){
    if(provider!==null && !['google','kakao','naver'].includes(provider))throw Error('지원하지 않는 로그인 수단입니다.');
    const popup=window.open('about:blank','_blank','popup,width=480,height=780');
    if(!popup)throw Error('로그인 팝업이 차단됐습니다. 팝업을 허용해 주세요.');
    let verifier,requestId;
    try{
      verifier=proof();
      requestId=proof();
      const hashed=await challenge(verifier);
      const url=new URL('/connect',ACCOUNT_ORIGIN);
      url.searchParams.set('site',ACCOUNT_SITE);
      url.searchParams.set('origin',window.location.origin);
      url.searchParams.set('challenge',hashed);
      url.searchParams.set('request',requestId);
      if(provider)url.searchParams.set('provider',provider);
      return await new Promise((resolve,reject)=>{
        let timer,watch,finished=false,exchanging=false;
        const cleanup=()=>{
          window.removeEventListener('message',onMessage);
          clearTimeout(timer);clearInterval(watch);
        };
        const close=()=>{try{popup.close();}catch{}};
        const fail=error=>{if(finished)return;finished=true;cleanup();close();reject(error);};
        async function onMessage(event){
          if(event.source!==popup || event.origin!==ACCOUNT_ORIGIN ||
             event.data?.type!=='softm:authorization' || event.data?.requestId!==requestId)return;
          if(exchanging)return;
          if(!validAuthorizationMessage(event,popup,requestId)){
            fail(Error('로그인 인증 응답이 올바르지 않습니다.'));return;
          }
          exchanging=true;clearInterval(watch);
          try{
            const response=await fetch(ACCOUNT_ORIGIN+'/api/connect/exchange',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              cache:'no-store',
              body:JSON.stringify({site:ACCOUNT_SITE,origin:window.location.origin,code:event.data.code,verifier}),
              signal:AbortSignal.timeout(15000)
            });
            const value=await response.json().catch(()=>({}));
            if(!response.ok)throw Error(value.message||'인증 세션을 교환하지 못했습니다.');
            if(!PROOF.test(value.accessToken||'') || typeof value.uid!=='string' ||
              !Number.isFinite(value.expiresIn) || value.expiresIn<=0 || value.expiresIn>3600)
              throw Error('계정 서버가 올바른 세션을 반환하지 않았습니다.');
            auth={
              token:value.accessToken,uid:value.uid,
              expiresAt:Date.now()+value.expiresIn*1000,
              displayName:typeof value.displayName==='string'?value.displayName.slice(0,120):'',
              photoURL:typeof value.photoURL==='string'?value.photoURL.slice(0,2048):'',
              provider:provider || null
            };
            saveSession(auth);
            if(!finished){finished=true;cleanup();close();resolve(currentUser());}
          }catch(error){fail(error);}
        }
        window.addEventListener('message',onMessage);
        timer=setTimeout(()=>fail(Error('로그인 시간이 만료됐습니다. 다시 시도해 주세요.')),300000);
        watch=setInterval(()=>{
          if(popup.closed && !exchanging)fail(Error('로그인 창이 닫혔습니다.'));
        },700);
        try{popup.location.assign(url.href);}catch(error){fail(error);}
      });
    }catch(error){try{popup.close();}catch{}throw error;}
  }
  async function logout(){
    const previous=auth;
    auth=null;
    try{sessionStorage.removeItem(SESSION_KEY);}catch{}
    if(previous && previous.expiresAt>Date.now()){
      try{
        await fetch(ACCOUNT_ORIGIN+'/api/apps/'+ACCOUNT_SITE+'/logout',{
          method:'POST',headers:{Authorization:'Bearer '+previous.token,'Content-Type':'application/json'},
          body:'{}',cache:'no-store',signal:AbortSignal.timeout(7000)
        });
      }catch{/* Local session is cleared even if the network is unavailable. */}
    }
  }
  return Object.freeze({login,logout,get currentUser(){return currentUser();}});
}
