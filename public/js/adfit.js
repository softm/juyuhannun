import {ADFIT_CONFIG,NATIVE_ADS} from '../adfit-config.js';

const nodes=new Map();
let sdkReady;
let serial=0;
let bottomController;
export const BOTTOM_AD_STORAGE_KEY='juyuhannun:ad-bottom:expanded:v1';

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

function createAdNode(slot,{onState=()=>{}}={}){
  const node=document.createElement('aside');
  node.className='station-detail-ad';node.setAttribute('aria-label','광고');node.hidden=true;
  const label=document.createElement('span');label.className='station-detail-ad-label';label.textContent='광고';
  const body=document.createElement('div');body.className='station-detail-ad-body';
  node.append(label,body);
  let attempted=false,queued=false,visible=false,timeout;
  const setState=state=>{node.dataset.state=state;onState(state);};
  const stop=()=>{clearTimeout(timeout);body.replaceChildren();body.style.minHeight='';node.hidden=true;setState('empty');};
  const eligible=()=>ADFIT_CONFIG.enabled&&isProduction()&&visible&&!document.hidden&&node.isConnected&&body.clientWidth>=slot.width;
  function start(ready,abort){
    attempted=true;queued=false;observer.disconnect();document.removeEventListener('visibilitychange',request);
    node.hidden=false;body.style.minHeight=`${slot.height}px`;setState('requested');
    const ins=document.createElement('ins');ins.className='kakao_ad_area';ins.style.display='none';
    ins.dataset.adUnit=slot.unit;ins.dataset.adWidth=String(slot.width);ins.dataset.adHeight=String(slot.height);
    const id=++serial,failed=`juyuAdFailed${id}`,loaded=`juyuAdLoaded${id}`;
    window[failed]=()=>{ready?.();stop();};ins.dataset.adOnfail=failed;
    window[loaded]=()=>{clearTimeout(timeout);node.hidden=false;setState('filled');ready?.();};ins.dataset.adOnload=loaded;
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

export function mountBottomAd({win=window,doc=document}={}){
  if(bottomController)return bottomController;
  const slot=ADFIT_CONFIG.bottom;
  const viewportWidth=Math.max(doc.documentElement?.clientWidth||0,win.innerWidth||0);
  if(NATIVE_ADS||!ADFIT_CONFIG.enabled||!isProduction()||!slot||viewportWidth<slot.width)return null;
  const shell=doc.createElement('aside');shell.className='juyu-bottom-ad';shell.hidden=true;shell.setAttribute('aria-label','하단 광고');
  shell.innerHTML='<button type="button" class="juyu-bottom-ad-toggle" aria-controls="juyuBottomAdPanel" aria-expanded="true" aria-label="하단 광고 접기"><span class="juyu-bottom-ad-grip" aria-hidden="true"></span><span class="juyu-bottom-ad-chevron" aria-hidden="true"></span></button><section id="juyuBottomAdPanel" class="juyu-bottom-ad-panel" aria-label="광고"></section>';
  const button=shell.querySelector('.juyu-bottom-ad-toggle'),panel=shell.querySelector('.juyu-bottom-ad-panel');
  let expanded=true,resizeObserver,dragStartY=0,dragDistance=0,dragging=false,suppressClick=false;
  try{const stored=win.sessionStorage.getItem(BOTTOM_AD_STORAGE_KEY);if(stored!==null)expanded=stored==='true';}catch{}
  const syncSpace=()=>{const height=shell.hidden?0:Math.ceil(shell.getBoundingClientRect().height);doc.body.style.setProperty('--juyu-bottom-ad-space',`${height}px`);doc.body.classList.toggle('juyu-bottom-ad-active',height>0);};
  const node=createAdNode(slot,{onState:state=>{if(state==='empty'){shell.hidden=true;syncSpace();}else syncSpace();}});
  panel.append(node);doc.body.append(shell);shell.hidden=false;
  const resetDrag=()=>{dragging=false;dragDistance=0;shell.classList.remove('is-dragging');shell.style.removeProperty('--juyu-bottom-ad-drag');};
  const sync=()=>{resetDrag();panel.hidden=!expanded;shell.classList.toggle('is-collapsed',!expanded);button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',expanded?'하단 광고 접기':'하단 광고 펼치기');node.hidden=!expanded||node.dataset.state==='empty';syncSpace();};
  const setExpanded=value=>{expanded=Boolean(value);try{win.sessionStorage.setItem(BOTTOM_AD_STORAGE_KEY,String(expanded));}catch{}sync();};
  const toggle=()=>{if(suppressClick){suppressClick=false;return;}setExpanded(!expanded);};
  const onPointerDown=event=>{if(!expanded||event.button>0)return;dragging=true;suppressClick=false;dragStartY=event.clientY;dragDistance=0;shell.classList.add('is-dragging');button.setPointerCapture?.(event.pointerId);};
  const onPointerMove=event=>{if(!dragging)return;dragDistance=Math.max(0,event.clientY-dragStartY);if(dragDistance>4)suppressClick=true;shell.style.setProperty('--juyu-bottom-ad-drag',`${dragDistance}px`);event.preventDefault();};
  const onPointerEnd=event=>{if(!dragging)return;button.releasePointerCapture?.(event.pointerId);const collapse=dragDistance>=36;resetDrag();if(collapse)setExpanded(false);};
  button.addEventListener('click',toggle);button.addEventListener('pointerdown',onPointerDown);button.addEventListener('pointermove',onPointerMove);button.addEventListener('pointerup',onPointerEnd);button.addEventListener('pointercancel',onPointerEnd);
  resizeObserver=win.ResizeObserver?new win.ResizeObserver(syncSpace):null;resizeObserver?.observe(shell);sync();
  bottomController={setExpanded,destroy(){resizeObserver?.disconnect();button.removeEventListener('click',toggle);button.removeEventListener('pointerdown',onPointerDown);button.removeEventListener('pointermove',onPointerMove);button.removeEventListener('pointerup',onPointerEnd);button.removeEventListener('pointercancel',onPointerEnd);shell.remove();doc.body.style.setProperty('--juyu-bottom-ad-space','0px');doc.body.classList.remove('juyu-bottom-ad-active');bottomController=null;}};
  return bottomController;
}
