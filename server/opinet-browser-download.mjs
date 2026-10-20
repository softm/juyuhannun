import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { ServiceError } from './errors.mjs';
import { OPINET_DOWNLOAD_URL, decodeKoreanCsv, csvObjects } from './opinet-download.mjs';

const CANDIDATES=[
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function executablePath(){
  for(const path of CANDIDATES){try{await access(path);return path;}catch{}}
  throw new ServiceError('CHROMIUM_NOT_FOUND','전국 가격 다운로드에 사용할 Chromium/Chrome 실행 파일을 찾지 못했습니다.');
}
async function bufferFromDownload(download){
  const stream=await download.createReadStream();
  if(!stream)throw new ServiceError('OPINET_DOWNLOAD_STREAM_ERROR','오피넷 CSV 다운로드 스트림을 열지 못했습니다.');
  const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function kstDate(now=Date.now()){
  return new Date(now+9*60*60*1000).toISOString().slice(0,10).replaceAll('-','');
}

export class OpinetBrowserDownloadClient{
  constructor({clock=Date.now,timeoutMs=300000}={}){this.clock=clock;this.timeoutMs=timeoutMs;}
  async dailyPrices({targetDate=kstDate(this.clock()),businessType='A'}={}){
    if(!/^\d{8}$/.test(targetDate)||!['A','B'].includes(businessType))throw new ServiceError('OPINET_DOWNLOAD_REQUEST_INVALID','전국 가격 다운로드 날짜/업종을 확인해 주세요.',400);
    const path=await executablePath();let browser;
    try{
      browser=await chromium.launch({executablePath:path,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--disable-extensions','--disable-background-networking']});
      const context=await browser.newContext({
        userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        locale:'ko-KR',acceptDownloads:true,
      });
      const page=await context.newPage();
      page.on('dialog',dialog=>dialog.accept().catch(()=>{}));
      await page.goto(OPINET_DOWNLOAD_URL,{waitUntil:'domcontentloaded',timeout:120000});
      try{
        await page.waitForFunction(()=>typeof globalThis.fn_Download==='function',undefined,{timeout:this.timeoutMs});
      }catch{throw new ServiceError('OPINET_NETFUNNEL_TIMEOUT','오피넷 공개 다운로드 화면 준비가 지연되어 이번 전국 수집을 중단했습니다.');}
      await page.evaluate(({date,type})=>{
        const setValue=(selector,value)=>{const el=document.querySelector(selector);if(el){el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}};
        setValue('#span_start_date_picker',date);setValue('#span_end_date_picker',date);
        for(const name of ['START_DT','startDt'])setValue(`[name="${name}"]`,date);
        for(const name of ['END_DT','endDt'])setValue(`[name="${name}"]`,date);
        const radio=(name,value)=>{const el=document.querySelector(`input[name="${name}"][value="${value}"]`);if(el){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}};
        radio('rdo3',type);radio('rdo4','X');
        if(globalThis.$){
          globalThis.$('#span_start_date_picker').val(date);
          globalThis.$('#span_end_date_picker').val(date);
          globalThis.$(`input[name="rdo3"][value="${type}"]`).prop('checked',true).trigger('change');
          globalThis.$('input[name="rdo4"][value="X"]').prop('checked',true).trigger('change');
        }
      },{date:targetDate,type:businessType});
      const [download]=await Promise.all([
        page.waitForEvent('download',{timeout:600000}),
        page.evaluate(()=>globalThis.fn_Download(6)),
      ]);
      const bytes=await bufferFromDownload(download);
      if(bytes.byteLength<10000)throw new ServiceError('OPINET_DOWNLOAD_EMPTY','오피넷 전국 가격 CSV가 비어 있거나 예상보다 작습니다.');
      const text=decodeKoreanCsv(bytes);
      if(/^\s*</.test(text.slice(0,200)))throw new ServiceError('OPINET_DOWNLOAD_HTML_RESPONSE','CSV 대신 웹 페이지가 반환되었습니다.');
      const rows=csvObjects(text);
      if(rows.length<100)throw new ServiceError('OPINET_DOWNLOAD_EMPTY','오피넷 전국 가격 CSV의 데이터 행이 충분하지 않습니다.');
      return {rows,bytes:bytes.byteLength,targetDate,suggestedFilename:download.suggestedFilename()||null};
    }catch(error){
      if(error instanceof ServiceError)throw error;
      throw new ServiceError('OPINET_BROWSER_DOWNLOAD_ERROR','오피넷 공개 전국 가격 CSV 다운로드에 실패했습니다.');
    }finally{if(browser)await browser.close().catch(()=>{});}
  }
}

export { kstDate };
