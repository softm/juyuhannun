const RAD=Math.PI/180;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function bearingDegrees(from,to){
 const lat1=from.lat*RAD,lat2=to.lat*RAD,dLng=(to.lng-from.lng)*RAD;
 const y=Math.sin(dLng)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
 return (Math.atan2(y,x)/RAD+360)%360;
}
export function signedBearingDelta(bearing,heading){return ((bearing-heading+540)%360)-180;}
export function selectHudStations(stations,{point,heading,maxDistance=10000,maxItems=6}={}){
 if(!point||!Number.isFinite(heading))return[];
 return stations.map(station=>{
  const distance=Number(station.distanceMeters),bearing=bearingDegrees(point,station),delta=signedBearingDelta(bearing,heading);
  return{...station,distanceMeters:distance,bearing,delta};
 }).filter(station=>Number.isFinite(station.lat)&&Number.isFinite(station.lng)&&Number.isFinite(station.distanceMeters)&&station.distanceMeters<=maxDistance&&Math.abs(station.delta)<=72)
 .sort((a,b)=>(a.distanceMeters*(1+Math.abs(a.delta)/90))-(b.distanceMeters*(1+Math.abs(b.delta)/90))).slice(0,maxItems);
}

function stationCard(station,index){
 const distanceRatio=clamp(Math.log10(Math.max(50,station.distanceMeters)/50)/Math.log10(200),0,1),left=50+(station.delta/72)*42,top=68-distanceRatio*40,scale=1.08-distanceRatio*.42,brand=station.brandVisual||{};
 const card=document.createElement('div');card.className='drive-hud-station';card.style.setProperty('--hud-left',`${left}%`);card.style.setProperty('--hud-top',`${top}%`);card.style.setProperty('--hud-scale',String(scale));card.style.setProperty('--hud-delay',`${index*-.24}s`);card.style.zIndex=String(20-index);card.setAttribute('role','listitem');
 const logo=document.createElement('span');logo.className='drive-hud-brand';logo.style.background=brand.color||'#64748b';logo.style.color=brand.ink||'#fff';
 if(brand.image){const image=document.createElement('img');image.src=brand.image;image.alt='';logo.appendChild(image);}else logo.textContent=brand.short||'?';
 const copy=document.createElement('span');copy.className='drive-hud-station-copy';const price=document.createElement('strong');price.textContent=`${Number(station.price).toLocaleString('ko-KR')}원`;const detail=document.createElement('small');detail.textContent=`${station.name} · ${station.distanceLabel}`;copy.append(price,detail);
 const direction=document.createElement('span');direction.className='drive-hud-direction';direction.textContent=Math.abs(station.delta)<12?'↑':station.delta<0?'↖':'↗';direction.setAttribute('aria-hidden','true');card.append(logo,copy,direction);return card;
}

export function createDrivingHud({host}={}){
 if(!host)return{setActive(){},update(){},resize(){},destroy(){}};
 const stage=document.createElement('div');stage.className='drive-hud-stage';stage.innerHTML='<div class="drive-hud-road" aria-hidden="true"><i></i><i></i><i></i></div><div class="drive-hud-stations" role="list" aria-label="전방 주유소"></div>';
 host.appendChild(stage);const stationsHost=stage.querySelector('.drive-hud-stations');let active=false;
 function setActive(next){active=Boolean(next);host.hidden=!active;if(!active)stationsHost.replaceChildren();}
 function update(stations,{point,heading}={}){if(!active)return;stationsHost.replaceChildren(...selectHudStations(stations,{point,heading}).map(stationCard));}
 return{setActive,update,resize(){},destroy(){stage.remove();}};
}
