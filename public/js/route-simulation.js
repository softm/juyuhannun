import {normalizeRoutePath} from './route-candidates.js';

function distance(a,b){
  const rad=Math.PI/180,dLat=(b[1]-a[1])*rad,dLng=(b[0]-a[0])*rad;
  const value=Math.sin(dLat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLng/2)**2;
  return 6371000*2*Math.asin(Math.min(1,Math.sqrt(value)));
}

export function routePathLengths(path){
  const points=normalizeRoutePath(path),lengths=[0];
  for(let index=1;index<points.length;index++)lengths.push(lengths[index-1]+distance(points[index-1],points[index]));
  return {path:points,lengths,total:lengths.at(-1)||0};
}

export function routeTrajectory(path){
  const measured=routePathLengths(path);
  if(measured.path.length<2||measured.total<=0)throw new Error('모의주행 경로를 확인할 수 없습니다.');
  return fraction=>{
    const target=Math.max(0,Math.min(1,Number(fraction)||0))*measured.total;
    let low=1,high=measured.path.length-1;
    while(low<high){const middle=(low+high)>>1;if(measured.lengths[middle]<target)low=middle+1;else high=middle;}
    const span=measured.lengths[low]-measured.lengths[low-1],ratio=span?(target-measured.lengths[low-1])/span:0;
    return {
      lng:measured.path[low-1][0]+(measured.path[low][0]-measured.path[low-1][0])*ratio,
      lat:measured.path[low-1][1]+(measured.path[low][1]-measured.path[low-1][1])*ratio,
    };
  };
}

export function routeMilestones(path,stops=[]){
  const measured=routePathLengths(path),scale=Math.cos((measured.path[0]?.[1]||37)*Math.PI/180);
  if(measured.path.length<2||measured.total<=0)return [];
  const metric=(a,b)=>Math.hypot((b[0]-a[0])*scale,b[1]-a[1]);
  let previous=0;
  return (Array.isArray(stops)?stops:[]).filter(stop=>Number.isInteger(stop?.pathIndex)||(Number.isFinite(stop?.point?.lng)&&Number.isFinite(stop?.point?.lat))).map(stop=>{
    if(Number.isInteger(stop.pathIndex)&&stop.pathIndex>=0&&stop.pathIndex<measured.path.length){
      const fraction=Math.max(previous,measured.lengths[stop.pathIndex]/measured.total);previous=fraction;return {...stop,fraction};
    }
    let best=Infinity,fraction=previous;
    for(let index=1;index<measured.path.length;index++){
      const a=measured.path[index-1],b=measured.path[index],dx=(b[0]-a[0])*scale,dy=b[1]-a[1],span=measured.lengths[index]-measured.lengths[index-1];
      if(!span||measured.lengths[index]<previous*measured.total)continue;
      const minimum=Math.max(0,(previous*measured.total-measured.lengths[index-1])/span);
      const ratio=Math.max(minimum,Math.min(1,((stop.point.lng-a[0])*scale*dx+(stop.point.lat-a[1])*dy)/(dx*dx+dy*dy)));
      const gap=metric([a[0]+(b[0]-a[0])*ratio,a[1]+dy*ratio],[stop.point.lng,stop.point.lat]);
      if(gap<best){best=gap;fraction=(measured.lengths[index-1]+span*ratio)/measured.total;}
    }
    previous=fraction;return {...stop,fraction};
  });
}

export function createRouteSimulationController({host,onPosition=()=>{},onClear=()=>{}}={}){
  if(!host)throw new Error('모의주행 조작 영역이 없습니다.');
  const play=host.querySelector('[data-simulation-play]');
  const options=host.querySelector('[data-simulation-options]');
  const controls=host.querySelector('[data-simulation-controls]');
  const restart=host.querySelector('[data-simulation-restart]');
  const stop=host.querySelector('[data-simulation-stop]');
  const speed=host.querySelector('[data-simulation-speed]');
  const output=host.querySelector('[data-simulation-progress]');
  const progress=host.querySelector('progress');
  const label=host.querySelector('[data-simulation-label]');
  const arrival=host.querySelector('[data-simulation-arrival]');
  const station=host.querySelector('[data-simulation-station]');
  let route=null,pointAt=null,milestones=[],nextStop=0,frame=null,elapsed=0,last=0,holdUntil=0,cameraAt=0,playing=false;

  function setOptionsOpen(open){controls.hidden=!open;options.setAttribute('aria-expanded',String(open));options.textContent=open?'접기':'설정';}
  function setStationName(name=''){const value=String(name||'').trim();station.hidden=!value;station.textContent=value?`탐색 주유소 · ${value}`:'';}
  function resetStops(){nextStop=0;holdUntil=0;arrival.hidden=true;arrival.textContent='';setStationName();}
  function paint(now=0){
    if(!route||!pointAt)return 0;
    const fraction=Math.min(1,elapsed/Math.max(1000,route.durationSeconds*1000));
    output.textContent=`${Math.round(fraction*100)}%`;progress.value=fraction;
    onPosition(pointAt(fraction),{follow:now>0&&now-cameraAt>=1000});
    if(now>0&&now-cameraAt>=1000)cameraAt=now;
    return fraction;
  }
  function pause(){playing=false;host.classList.remove('is-playing');if(frame!==null)cancelAnimationFrame(frame);frame=null;play.textContent=progress.value>=1?'다시 재생':'계속';}
  function reset({removeMarker=true}={}){pause();elapsed=0;last=0;cameraAt=0;resetStops();progress.value=0;output.textContent='0%';play.textContent='시작';setOptionsOpen(false);if(removeMarker)onClear();}
  function tick(now){
    if(!playing||!route)return;
    if(now<holdUntil){last=now;frame=requestAnimationFrame(tick);return;}
    if(holdUntil){holdUntil=0;arrival.hidden=true;setStationName(milestones[nextStop]?.name||milestones.at(-1)?.name);}
    elapsed+=Math.min(250,Math.max(0,now-last))*Number(speed.value||600);last=now;
    const milestone=milestones[nextStop];
    if(milestone&&elapsed/Math.max(1000,route.durationSeconds*1000)>=milestone.fraction){
      elapsed=milestone.fraction*Math.max(1000,route.durationSeconds*1000);nextStop+=1;arrival.textContent=`${milestone.name||'경유지'} 도착`;arrival.hidden=false;holdUntil=now+650;
    }
    const fraction=paint(now);
    if(fraction>=1&&nextStop>=milestones.length){pause();play.textContent='다시 재생';output.textContent='도착 · 100%';return;}
    frame=requestAnimationFrame(tick);
  }
  function start(){
    if(!route)return;
    if(progress.value>=1)reset({removeMarker:false});
    paint();playing=true;host.classList.add('is-playing');play.textContent='일시정지';last=performance.now();frame=requestAnimationFrame(tick);
  }
  function set(next){
    reset();
    const path=normalizeRoutePath(next?.path),durationSeconds=Number(next?.durationSeconds);
    route=path.length>=2&&Number.isFinite(durationSeconds)&&durationSeconds>0?{...next,path,durationSeconds}:null;
    host.hidden=!route;
    if(!route){pointAt=null;milestones=[];label.textContent='모의주행';return;}
    pointAt=routeTrajectory(route.path);milestones=routeMilestones(route.path,route.stops);label.textContent=route.label||'경로 모의주행';setStationName(milestones[0]?.name);
  }

  play.addEventListener('click',()=>playing?pause():start());
  options.addEventListener('click',()=>setOptionsOpen(controls.hidden));
  restart.addEventListener('click',()=>{reset({removeMarker:false});start();});
  stop.addEventListener('click',()=>reset());
  const visibility=()=>{if(document.hidden&&playing)pause();};document.addEventListener('visibilitychange',visibility);
  setOptionsOpen(false);host.hidden=true;
  return {set,pause,reset,destroy(){reset();route=null;host.hidden=true;document.removeEventListener('visibilitychange',visibility);}};
}
