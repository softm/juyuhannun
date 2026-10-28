const valid=item=>item&&typeof item.label==='string'&&Number.isFinite(Number(item.lat))&&Number.isFinite(Number(item.lng))&&Number(item.lat)>=32&&Number(item.lat)<=40&&Number(item.lng)>=123&&Number(item.lng)<=133;
const distance=(a,b)=>{const r=Math.PI/180,dLat=(a.lat-b.lat)*r,dLng=(a.lng-b.lng)*r,h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));};
export function normalizeRouteHistory(value,{limit=10}={}){return(Array.isArray(value)?value:[]).filter(valid).map((item,index)=>({id:String(item.id||`${Number(item.lat).toFixed(5)},${Number(item.lng).toFixed(5)}`),label:item.label.trim().slice(0,100)||'최근 목적지',lat:Number(item.lat),lng:Number(item.lng),lastUsedAt:Number(item.lastUsedAt)||Date.now()-index,useCount:Math.max(1,Number(item.useCount)||1)})).sort((a,b)=>b.lastUsedAt-a.lastUsedAt).slice(0,limit);}
export function rememberRouteDestination(history,item,{now=Date.now(),limit=10}={}){
 if(!valid(item))return normalizeRouteHistory(history,{limit});const next={id:String(item.id||`${Number(item.lat).toFixed(5)},${Number(item.lng).toFixed(5)}`),label:String(item.label||'최근 목적지').trim().slice(0,100),lat:Number(item.lat),lng:Number(item.lng),lastUsedAt:now,useCount:1};
 const rows=normalizeRouteHistory(history,{limit:100}),match=rows.find(row=>distance(row,next)<=50||row.label===next.label&&distance(row,next)<=200);
 if(match){next.id=match.id;next.useCount=match.useCount+1;}
 return[next,...rows.filter(row=>row.id!==next.id&&distance(row,next)>50)].slice(0,limit);
}
