import * as THREE from '../vendor/three.module.min.js';

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
  const distance=Number(station.distanceMeters);
  const bearing=bearingDegrees(point,station),delta=signedBearingDelta(bearing,heading);
  return{...station,distanceMeters:distance,bearing,delta};
 }).filter(station=>Number.isFinite(station.lat)&&Number.isFinite(station.lng)&&Number.isFinite(station.distanceMeters)&&station.distanceMeters<=maxDistance&&Math.abs(station.delta)<=72)
 .sort((a,b)=>(a.distanceMeters*(1+Math.abs(a.delta)/90))-(b.distanceMeters*(1+Math.abs(b.delta)/90))).slice(0,maxItems);
}

function roundedRect(context,x,y,width,height,radius){
 context.beginPath();context.roundRect(x,y,width,height,radius);context.closePath();
}
function markerTexture(station){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=192;
 const context=canvas.getContext('2d'),brand=station.brandVisual||{};
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;
 function draw(logo=null){
  context.clearRect(0,0,canvas.width,canvas.height);
  roundedRect(context,8,8,496,150,38);context.fillStyle='rgba(8,65,52,.94)';context.fill();context.lineWidth=7;context.strokeStyle='rgba(255,255,255,.95)';context.stroke();
  context.save();context.beginPath();context.arc(78,82,50,0,Math.PI*2);context.clip();context.fillStyle=logo?'#fff':brand.color||'#64748b';context.fillRect(28,32,100,100);
  if(logo)context.drawImage(logo,28,32,100,100);else{context.fillStyle=brand.ink||'#fff';context.textAlign='center';context.textBaseline='middle';context.font='900 32px system-ui,sans-serif';context.fillText(brand.short||'?',78,84);}context.restore();
  context.beginPath();context.arc(78,82,50,0,Math.PI*2);context.lineWidth=6;context.strokeStyle='#fff';context.stroke();
  context.textAlign='left';context.textBaseline='middle';context.fillStyle='#fff';context.font='900 49px system-ui,sans-serif';context.fillText(`${Number(station.price).toLocaleString('ko-KR')}원`,148,70);
  context.fillStyle='#cce8df';context.font='700 26px system-ui,sans-serif';context.fillText(`${station.name} · ${station.distanceLabel}`,148,119);
  context.beginPath();context.moveTo(228,158);context.lineTo(274,158);context.lineTo(251,187);context.closePath();context.fillStyle='rgba(8,65,52,.94)';context.fill();texture.needsUpdate=true;
 }
 draw();if(brand.image){const image=new Image();image.decoding='async';image.onload=()=>draw(image);image.src=brand.image;}return texture;
}

export function createDrivingHud({host}={}){
 if(!host)return{setActive(){},update(){},resize(){},destroy(){}};
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(46,1,.1,120);
 camera.position.set(0,3.2,9);camera.lookAt(0,1,-18);
 let renderer;try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});}catch{host.dataset.unavailable='true';return{setActive(){},update(){},resize(){},destroy(){}};}
 renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.domElement.className='drive-hud-canvas';renderer.domElement.setAttribute('aria-hidden','true');host.appendChild(renderer.domElement);
 const road=new THREE.Group();scene.add(road);
 const roadMaterial=new THREE.MeshBasicMaterial({color:0x0d4237,transparent:true,opacity:.48,side:THREE.DoubleSide});
 const roadMesh=new THREE.Mesh(new THREE.PlaneGeometry(10,90),roadMaterial);roadMesh.rotation.x=-Math.PI/2;roadMesh.position.set(0,-.05,-34);road.add(roadMesh);
 const lineMaterial=new THREE.LineBasicMaterial({color:0xb7ffe6,transparent:true,opacity:.75});
 for(const x of [-3.2,0,3.2]){const points=[];for(let z=4;z>-78;z-=6){points.push(new THREE.Vector3(x,0,z),new THREE.Vector3(x,0,z-2.8));}road.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),lineMaterial));}
 const markerGroup=new THREE.Group();scene.add(markerGroup);
 let active=false,lastFrame=0;
 function clearMarkers(){for(const sprite of [...markerGroup.children]){sprite.material.map?.dispose();sprite.material.dispose();markerGroup.remove(sprite);}}
 function resize(){const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
 function draw(time=0){if(!active)return;if(time-lastFrame>32){lastFrame=time;markerGroup.children.forEach((sprite,index)=>{sprite.position.y=sprite.userData.baseY+Math.sin(time/500+index)*.08;});renderer.render(scene,camera);}renderer.setAnimationLoop(draw);}
 function setActive(next){active=Boolean(next);host.hidden=!active;if(active){resize();renderer.setAnimationLoop(draw);}else renderer.setAnimationLoop(null);}
 function update(stations,{point,heading}={}){
  clearMarkers();if(!active)return;
  for(const [index,station] of selectHudStations(stations,{point,heading}).entries()){
   const depth=clamp(7+Math.log10(Math.max(10,station.distanceMeters))*9,14,42),angle=station.delta*RAD;
   const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture(station),transparent:true,depthTest:false}));
   const x=Math.tan(angle)*depth*.42,scale=clamp(6.8-(depth-14)*.08,4.4,6.8),y=1.8+index%2*.35;
   sprite.position.set(x,y,-depth);sprite.scale.set(scale*2.66,scale,1);sprite.renderOrder=20-index;sprite.userData.baseY=y;markerGroup.add(sprite);
  }
  renderer.render(scene,camera);
 }
 const observer=new ResizeObserver(resize);observer.observe(host);
 return{setActive,update,resize,destroy(){observer.disconnect();renderer.setAnimationLoop(null);clearMarkers();renderer.dispose();renderer.domElement.remove();}};
}
