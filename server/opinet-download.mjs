import { ServiceError } from './errors.mjs';

export const OPINET_DOWNLOAD_URL = 'https://www.opinet.co.kr/user/opdown/opDownload.do';
const SOURCE = Object.freeze({
  name: '한국석유공사 오피넷 유가내려받기',
  url: OPINET_DOWNLOAD_URL,
  publicDataUrl: 'https://www.data.go.kr/data/15044646/fileData.do',
});

const decodeEntity = value => String(value ?? '')
  .replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>');

function attrs(tag) {
  const out={};
  for(const m of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()]=decodeEntity(m[2]??m[3]??m[4]??'');
  return out;
}

export function extractDownloadForm(html) {
  const match=String(html).match(/<form\b[^>]*(?:name|id)\s*=\s*["']commonForm["'][^>]*>([\s\S]*?)<\/form>/i);
  const scope=match?.[1]??String(html);
  const params=new URLSearchParams();
  for(const tag of scope.match(/<input\b[^>]*>/gi)??[]) {
    const a=attrs(tag); if(!a.name) continue;
    const type=(a.type||'text').toLowerCase();
    if((type==='radio'||type==='checkbox')&&!/\bchecked\b/i.test(tag)) continue;
    params.set(a.name,a.value??'');
  }
  return params;
}

function cookies(headers) {
  const values=typeof headers.getSetCookie==='function'?headers.getSetCookie():[];
  if(values.length) return values.map(v=>v.split(';',1)[0]).join('; ');
  const raw=headers.get('set-cookie'); return raw?raw.split(/,(?=[^;,]+=)/).map(v=>v.split(';',1)[0]).join('; '):'';
}

export function decodeKoreanCsv(bytes) {
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(data[0]===0xef&&data[1]===0xbb&&data[2]===0xbf) return new TextDecoder('utf-8').decode(data.subarray(3));
  try { return new TextDecoder('utf-8',{fatal:true}).decode(data); }
  catch { return new TextDecoder('euc-kr').decode(data); }
}

export function parseCsv(text) {
  const rows=[]; let row=[], field='', quoted=false;
  const input=String(text).replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(quoted){
      if(ch==='"'&&input[i+1]==='"'){field+='"';i++;}
      else if(ch==='"') quoted=false;
      else field+=ch;
    }else if(ch==='"') quoted=true;
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  return rows.filter(r=>r.some(v=>String(v).trim()!==''));
}

function toObjects(text) {
  const rows=parseCsv(text);
  const headerIndex=rows.findIndex(r=>r.some(v=>String(v).replace(/\s/g,'').includes('고유번호')));
  if(headerIndex<0) throw new ServiceError('OPINET_DOWNLOAD_SCHEMA_ERROR','오피넷 CSV에서 고유번호 열을 찾지 못했습니다.');
  const headers=rows[headerIndex].map(v=>String(v).trim().replace(/^\uFEFF/,''));
  return rows.slice(headerIndex+1).filter(r=>r.some(v=>String(v).trim()!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,String(r[i]??'').trim()])));
}

export class OpinetDownloadClient {
  constructor({fetchImpl=fetch,timeoutMs=30000}={}){this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;}
  async download({kind='current',searchCond='1'}={}) {
    if(!['basic','current'].includes(kind)||!['1','2'].includes(String(searchCond))) throw new ServiceError('OPINET_DOWNLOAD_REQUEST_INVALID','오피넷 내려받기 조건을 확인해 주세요.',400);
    let page;
    try{
      page=await this.fetchImpl(OPINET_DOWNLOAD_URL,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Mozilla/5.0 (compatible; juyuhannun-data-collector/1.0)'},signal:AbortSignal.timeout(this.timeoutMs)});
    }catch{throw new ServiceError('OPINET_DOWNLOAD_NETWORK_ERROR','오피넷 내려받기 페이지에 연결하지 못했습니다.');}
    if(!page.ok) throw new ServiceError('OPINET_DOWNLOAD_HTTP_ERROR','오피넷 내려받기 페이지 응답을 확인해 주세요.');
    const html=await page.text(); const form=extractDownloadForm(html);
    form.set('type',kind==='current'?'5':'4');
    form.set('searchCond',String(searchCond));
    for(const [name,value] of Object.entries({searchGubun:'1',searchSort:'1',searchCndGbn:'1',searchQryGbn:'1',searchDate:'D',searchSido:'',searchGugun:'',searchStrtDt:'',searchEndDt:'',searchStr:''})) if(!form.has(name)||name.startsWith('searchS')) form.set(name,value);
    let response;
    try{
      response=await this.fetchImpl(OPINET_DOWNLOAD_URL,{
        method:'POST',headers:{Accept:'text/csv,application/octet-stream,*/*','Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',Origin:'https://www.opinet.co.kr',Referer:OPINET_DOWNLOAD_URL,Cookie:cookies(page.headers),'User-Agent':'Mozilla/5.0 (compatible; juyuhannun-data-collector/1.0)'},
        body:form.toString(),signal:AbortSignal.timeout(this.timeoutMs),
      });
    }catch{throw new ServiceError('OPINET_DOWNLOAD_NETWORK_ERROR','오피넷 CSV 다운로드에 실패했습니다.');}
    if(!response.ok) throw new ServiceError('OPINET_DOWNLOAD_HTTP_ERROR','오피넷 CSV 다운로드 응답을 확인해 주세요.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.byteLength<1000) throw new ServiceError('OPINET_DOWNLOAD_EMPTY','오피넷 CSV 파일이 비어 있거나 너무 작습니다.');
    const text=decodeKoreanCsv(bytes);
    if(/^\s*</.test(text.slice(0,200))) throw new ServiceError('OPINET_DOWNLOAD_HTML_RESPONSE','CSV 대신 웹 페이지가 반환되었습니다.');
    const rows=toObjects(text);
    if(!rows.length) throw new ServiceError('OPINET_DOWNLOAD_EMPTY','오피넷 CSV에 데이터 행이 없습니다.');
    return {rows,source:SOURCE,bytes:bytes.byteLength};
  }
}
