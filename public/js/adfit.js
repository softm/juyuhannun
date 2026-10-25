import {ADFIT_CONFIG,NATIVE_ADS} from '../adfit-config.js';

const nodes=new Map();
let sdkReady;
let serial=0;

function isProduction(){
  return location.hostname===ADFIT_CONFIG.hostname&&location.pathname.startsWith(ADFIT_CONFIG.pathname);
}

function loadSdk(startFirst){
  let resolve,reject;
  sdkReady=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const ready=()=>typeof window.adfit?.render==='function'?resolve():reject(new Error('AdFit render unavailable'));
  startFirst(ready,reject);
  const script=document.createElement('script');
  script.async=true;script.charset='utf-8';script.src=ADFIT_CONFIG.script;
  script.onerror=()=>reject(new Error('AdFit SDK load failed'));
  script.onload=()=>{if(typeof window.adfit?.render!=='function')reject(new Error('AdFit SDK initialization failed'));};
  document.body.append(script);
}

function createAdNode(slot){
  const node=document.createElement('aside');
  node.className='station-detail-ad';node.setAttribute('aria-label','광고');node.hidden=true;
  const label=document.createElement('span');label.className='station-detail-ad-label';label.textContent='광고';
  const body=document.createElement('div');body.className='station-detail-ad-body';
  node.append(label,body);
  let attempted=false,queued=false,visible=false,timeout;
  const stop=()=>{clearTimeout(timeout);body.replaceChildren();body.style.minHeight='';node.hidden=true;node.dataset.state='empty';};
  const eligible=()=>ADFIT_CONFIG.enabled&&isProduction()&&visible&&!document.hidden&&node.isConnected&&body.clientWidth>=slot.width;
  function start(ready,abort){
    attempted=true;queued=false;observer.disconnect();document.removeEventListener('visibilitychange',request);
    node.hidden=false;body.style.minHeight=`${slot.height}px`;node.dataset.state='requested';
    const ins=document.createElement('ins');ins.className='kakao_ad_area';ins.style.display='none';
    ins.dataset.adUnit=slot.unit;ins.dataset.adWidth=String(slot.width);ins.dataset.adHeight=String(slot.height);
    const id=++serial,failed=`juyuAdFailed${id}`,loaded=`juyuAdLoaded${id}`;
    window[failed]=()=>{ready?.();stop();};ins.dataset.adOnfail=failed;
    window[loaded]=()=>{clearTimeout(timeout);node.hidden=false;node.dataset.state='filled';ready?.();};ins.dataset.adOnload=loaded;
    body.append(ins);
    timeout=setTimeout(()=>{if(abort)abort(new Error('AdFit response timeout'));if(!body.querySelector('iframe'))stop();},10000);
    return ins;
  }
  function request(){
    if(attempted||queued||!eligible())return;
    queued=true;
    if(!sdkReady){
      if(typeof window.adfit?.render==='function')sdkReady=Promise.resolve();
      else{loadSdk(start);sdkReady.catch(stop);return;}
    }
    sdkReady.then(()=>{queued=false;if(!eligible())return;const ins=start();try{window.adfit.render(ins);}catch{stop();}}).catch(()=>{queued=false;attempted=true;stop();});
  }
  const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);if(visible)request();});
  observer.observe(node);document.addEventListener('visibilitychange',request);
  return node;
}

export function mountStationDetailAd(host){
  if(!host)return;
  if(NATIVE_ADS||!ADFIT_CONFIG.enabled||!isProduction()){host.hidden=true;return;}
  const slot=matchMedia('(min-width:1001px)').matches?ADFIT_CONFIG.detail.desktop:ADFIT_CONFIG.detail.mobile;
  if(host.clientWidth<slot.width){host.hidden=true;return;}
  const key=slot.unit;
  if(!nodes.has(key))nodes.set(key,createAdNode(slot));
  const node=nodes.get(key);host.hidden=false;
  if(node.parentNode!==host)host.replaceChildren(node);
  node.hidden=node.dataset.state==='empty';
}

export function mountStationListAds(hosts){
  if(NATIVE_ADS||!ADFIT_CONFIG.enabled||!isProduction())return;
  [...hosts].forEach((host,index)=>{
    const slot=ADFIT_CONFIG.list?.[index];if(!slot||host.clientWidth<slot.width)return;
    const key=`list-${index}`;if(!nodes.has(key))nodes.set(key,createAdNode(slot));
    const node=nodes.get(key);host.hidden=false;if(node.parentNode!==host)host.replaceChildren(node);
  });
}
