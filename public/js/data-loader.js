const cache=new Map();
export async function loadStaticJSON(url,{signal,fetchImpl=fetch,now=Date.now(),cacheMs=60000}={}){
 const key=String(url),cached=cache.get(key);
 if(cached&&now-cached.at<cacheMs)return cached.data;
 const request=async path=>{
  const response=await fetchImpl(path,{signal,cache:'no-store',credentials:'omit'});
  if(!response.ok)throw new Error('가격 자료를 가져오지 못했습니다.');
  return response;
 };
 let data;
 if(typeof DecompressionStream==='function'&&/\.json(?=\?|$)/.test(key)){
  try{
   const response=await request(key.replace(/\.json(?=\?|$)/,'.json.gz'));
   // Fetch already decodes a Content-Encoding response; static .gz files
   // normally arrive as application/gzip and require explicit decompression.
   data=await (response.headers.get('content-encoding')?.includes('gzip')?response:new Response(response.body.pipeThrough(new DecompressionStream('gzip')))).json();
  }catch(error){if(signal?.aborted)throw error;}
 }
 if(!data)data=await (await request(key)).json();
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(cacheMs>0){if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,{at:now,data});}
 return data;
}
export function useNationwideData(data,fuel,{nationalSearch=false}={}){
 return Boolean(data&&['ready','partial'].includes(data.status)&&(data.coverage?.serviceReady!==false||(nationalSearch&&data.coverage?.searchIncludesUnmapped===true))&&Array.isArray(data.stations)&&data.stations.some(s=>Number.isFinite(s?.prices?.[fuel]?.price)&&s.prices[fuel].price>0));
}
