import {createDirectionsHandler,ALLOWED_ORIGINS} from './directions-core.mjs';
export default {
 async fetch(request,env){
  const headers=new Headers();
  const origin=request.headers.get('Origin')||'';
  if(ALLOWED_ORIGINS.has(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}
  headers.set('Content-Type','application/json; charset=utf-8');
  headers.set('Cache-Control','no-store');
  const respond=(status,error)=>new Response(JSON.stringify({error}),{status,headers});
  if(new URL(request.url).pathname!=='/directions')return respond(404,'요청 경로를 확인해 주세요.');
  if(!ALLOWED_ORIGINS.has(origin))return respond(403,'허용되지 않은 호출 출처입니다.');
  let body={};
  if(request.method==='POST'){
   // Limit streamed input before parsing; do not trust Content-Length alone.
   const reader=request.body?.getReader();let chunks=[],size=0;
   if(reader){for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return respond(413,'요청 데이터가 너무 큽니다.');}chunks.push(value);}}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return respond(400,'올바른 JSON 요청이 필요합니다.');}
  }
  let status=200,response;
  const res={setHeader(k,v){headers.set(k,v);},status(value){status=value;return this;},json(value){response=new Response(JSON.stringify(value),{status,headers});return response;},end(){response=new Response(null,{status,headers});return response;}};
  const req={method:request.method,headers:{origin,'content-length':request.headers.get('Content-Length')||'','x-forwarded-for':request.headers.get('CF-Connecting-IP')||'unknown'},body};
  try{await createDirectionsHandler({getApiSecret:()=>env.NAVER_MAPS_API_SECRET})(req,res);return response;}catch{return respond(502,'경로 서버 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.');}
 }
};
