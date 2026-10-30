const MIN_VISIBLE_MS=900;
let host,bar,label,active=0,startedAt=0,finishTimer;

function ensure(){
  if(host)return host;
  host=document.createElement('div');
  host.className='action-progress';host.hidden=true;
  host.setAttribute('role','progressbar');host.setAttribute('aria-live','polite');
  host.setAttribute('aria-valuemin','0');host.setAttribute('aria-valuemax','100');
  host.innerHTML='<span class="action-progress-track" aria-hidden="true"><i></i></span><strong class="action-progress-status"></strong>';
  bar=host.querySelector('i');label=host.querySelector('strong');document.body.append(host);return host;
}
function render(value,text){
  ensure();clearTimeout(finishTimer);host.hidden=false;host.classList.toggle('is-finishing',value>=100);
  host.setAttribute('aria-valuenow',String(value));host.setAttribute('aria-valuetext',text||'처리 중');bar.style.width=`${value}%`;label.textContent=text||'처리 중';
  queueMicrotask(()=>{const layer=document.querySelector('dialog[open]')||document.body;if(host.parentNode!==layer)layer.append(host);});
}
export function beginActionProgress(text='처리 중…'){
  active+=1;startedAt=startedAt||performance.now();render(18,text);requestAnimationFrame(()=>render(68,text));
  let done=false;return(message='완료')=>{if(done)return;done=true;active=Math.max(0,active-1);if(active)return;
    const wait=Math.max(0,MIN_VISIBLE_MS-(performance.now()-startedAt));finishTimer=setTimeout(()=>{render(100,message);finishTimer=setTimeout(()=>{host.hidden=true;host.classList.remove('is-finishing');bar.style.width='0%';startedAt=0;},240);},wait);};
}
function actionLabel(element){return element.getAttribute('aria-label')||element.textContent?.trim().replace(/\s+/g,' ').slice(0,34)||'처리 중…';}
document.addEventListener('click',event=>{
  const target=event.target.closest('a[href],button,[role="button"]');
  if(!target||target.disabled||target.getAttribute('aria-disabled')==='true'||target.closest('.action-progress'))return;
  const anchor=target.closest('a[href]');
  if(anchor){const url=new URL(anchor.href,location.href);if(anchor.target==='_blank'||url.origin!==location.origin||url.href===location.href||(url.hash&&url.pathname===location.pathname))return;beginActionProgress(`${actionLabel(target)} 이동 중…`);return;}
  const finish=beginActionProgress(`${actionLabel(target)} 처리 중…`);setTimeout(()=>finish('완료'),520);
},true);
document.addEventListener('submit',event=>{const finish=beginActionProgress(`${actionLabel(event.submitter||event.target)} 처리 중…`);if(event.defaultPrevented)setTimeout(()=>finish('완료'),520);});
window.addEventListener('pageshow',()=>{if(host){host.hidden=true;bar.style.width='0%';active=0;startedAt=0;}});
