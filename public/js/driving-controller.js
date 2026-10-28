const rad=Math.PI/180;

export function normalizeHeading(value){if(value==null||value==='')return null;const number=Number(value);return Number.isFinite(number)?(number%360+360)%360:null;}
export function headingDelta(a,b){const left=normalizeHeading(a),right=normalizeHeading(b);return left==null||right==null?180:Math.abs(((left-right+540)%360)-180);}
export function bearingBetween(a,b){
  if(!a||!b||![a.lat,a.lng,b.lat,b.lng].every(Number.isFinite))return null;
  const lat1=a.lat*rad,lat2=b.lat*rad,dLng=(b.lng-a.lng)*rad;
  return normalizeHeading(Math.atan2(Math.sin(dLng)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng))/rad);
}
export function distanceBetween(a,b){
  if(!a||!b||![a.lat,a.lng,b.lat,b.lng].every(Number.isFinite))return Infinity;
  const dLat=(b.lat-a.lat)*rad,dLng=(b.lng-a.lng)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function smoothHeading(previous,next,alpha=.32){
  const a=normalizeHeading(previous),b=normalizeHeading(next);if(a==null)return b;if(b==null)return a;
  const x=(1-alpha)*Math.cos(a*rad)+alpha*Math.cos(b*rad),y=(1-alpha)*Math.sin(a*rad)+alpha*Math.sin(b*rad);
  return normalizeHeading(Math.atan2(y,x)/rad);
}

export function createDrivingMotionState(){return{phase:'off',point:null,reliableHeading:null,headingSource:'unknown',movingSince:null,stoppedSince:null,lastAt:null,manual:false,suppressed:false};}

export function updateDrivingMotion(previous,fix,{now=Date.now(),routeActive=false,manual=false}={}){
  const state={...createDrivingMotionState(),...(previous||{})};
  const point={lat:Number(fix?.lat),lng:Number(fix?.lng)},accuracy=fix?.accuracy==null?NaN:Number(fix.accuracy),speed=fix?.speed==null?NaN:Number(fix.speed);
  if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng))return state;
  const elapsed=state.lastAt?Math.max(.001,(now-state.lastAt)/1000):0,moved=state.point?distanceBetween(state.point,point):0;
  const derivedSpeed=elapsed>0&&Number.isFinite(moved)?moved/elapsed:0;
  const effectiveSpeed=Number.isFinite(speed)&&speed>=0?speed:derivedSpeed;
  const accurate=!Number.isFinite(accuracy)||accuracy<=65;
  const movementEnough=state.point&&moved>=Math.max(6,Number.isFinite(accuracy)?accuracy*.25:6);
  const raw=normalizeHeading(fix?.heading);
  let candidate=null,source='held';
  if(accurate&&effectiveSpeed>=2&&raw!=null){candidate=raw;source='gps';}
  else if(accurate&&movementEnough){candidate=bearingBetween(state.point,point);source='movement';}
  const reliable=candidate==null?state.reliableHeading:smoothHeading(state.reliableHeading,candidate,headingDelta(state.reliableHeading,candidate)>90?.5:.3);
  const movingThreshold=routeActive?2.8:5.5,moving=accurate&&(effectiveSpeed>=movingThreshold||derivedSpeed>=movingThreshold);
  const stopped=accurate&&effectiveSpeed<1&&(!Number.isFinite(moved)||moved<10);
  if(moving){state.movingSince??=now;state.stoppedSince=null;}else{state.movingSince=null;if(stopped)state.stoppedSince??=now;}
  if(manual){state.phase='active';state.manual=true;state.suppressed=false;}
  else if(!state.suppressed){
    if(state.phase==='active'&&state.stoppedSince&&now-state.stoppedSince>=15000)state.phase='paused';
    else if(state.phase==='paused'&&moving)state.phase='active';
    else if(['off','candidate'].includes(state.phase)){
      state.phase=moving?'candidate':'off';
      const required=routeActive?6000:8000;if(state.movingSince&&now-state.movingSince>=required)state.phase='active';
    }
  }
  state.point=point;state.reliableHeading=reliable;state.headingSource=candidate==null?(reliable==null?'unknown':'held'):source;state.lastAt=now;
  state.speed=effectiveSpeed;state.accuracy=Number.isFinite(accuracy)?accuracy:null;
  return state;
}

export function drivingZoomForSpeed(speed){const kmh=Math.max(0,Number(speed)||0)*3.6;return kmh<10?16:kmh<40?15:kmh<80?14:13;}
