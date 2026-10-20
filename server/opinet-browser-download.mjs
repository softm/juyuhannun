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
  constructor({clock=Date.now,pageReadyTimeoutMs=180000,downloadTimeoutMs=300000}={}){this.clock=clock;this.pageReadyTimeoutMs=pageReadyTimeoutMs;this.downloadTimeoutMs=downloadTimeoutMs;}
  async currentPrices({businessType='station'}={}){
    if(!['station','lpg'].includes(businessType))throw new ServiceError('OPINET_DOWNLOAD_REQUEST_INVALID','전국 현재가격 다운로드 업종을 확인해 주세요.',400);
    const path=await executablePath();let browser;let stage='launch';
    const report=value=>console.info(JSON.stringify({event:'opinet_public_download',stage:value,businessType}));
    try{
      browser=await chromium.launch({executablePath:path,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--disable-extensions','--disable-background-networking']});
      stage='context';report(stage);
      const context=await browser.newContext({
        userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        locale:'ko-KR',acceptDownloads:true,
      });
      const page=await context.newPage();
      page.on('dialog',dialog=>{report(`dialog_${dialog.type()}`);dialog.accept().catch(()=>{});});
      stage='goto';report(stage);
      await page.goto(OPINET_DOWNLOAD_URL,{waitUntil:'domcontentloaded',timeout:120000});
      stage='wait_page';report(stage);
      await page.waitForSelector('.tbl_type20',{state:'visible',timeout:this.pageReadyTimeoutMs});
      await page.waitForFunction(()=>typeof globalThis.fn_Download==='function',undefined,{timeout:this.pageReadyTimeoutMs});
      if(businessType==='lpg'){
        stage='select_lpg';report(stage);
        for(const id of ['#rdo1_1','#rdo2_1']){
          const el=page.locator(id);
          if(await el.count())await el.click();
        }
      }
      stage='invoke_current_csv';report(stage);
      const downloadPromise=page.waitForEvent('download',{timeout:this.downloadTimeoutMs});
      await page.evaluate(()=>globalThis.fn_Download(5));
      const download=await downloadPromise;
      stage='read_download';report(stage);
      const bytes=await bufferFromDownload(download);
      if(bytes.byteLength<10000)throw new ServiceError('OPINET_DOWNLOAD_EMPTY','오피넷 전국 현재가격 CSV가 비어 있거나 예상보다 작습니다.');
      const text=decodeKoreanCsv(bytes);
      if(/^\s*</.test(text.slice(0,200)))throw new ServiceError('OPINET_DOWNLOAD_HTML_RESPONSE','CSV 대신 웹 페이지가 반환되었습니다.');
      const rows=csvObjects(text);
      if(rows.length<100)throw new ServiceError('OPINET_DOWNLOAD_EMPTY','오피넷 전국 현재가격 CSV의 데이터 행이 충분하지 않습니다.');
      report('ready');
      return {rows,bytes:bytes.byteLength,suggestedFilename:download.suggestedFilename()||null};
    }catch(error){
      console.info(JSON.stringify({event:'opinet_public_download',stage:'failed',failedAt:stage,businessType}));
      if(error instanceof ServiceError)throw error;
      throw new ServiceError('OPINET_BROWSER_DOWNLOAD_ERROR',`오피넷 공개 전국 현재가격 CSV 다운로드에 실패했습니다. 단계: ${stage}`);
    }finally{if(browser)await browser.close().catch(()=>{});}
  }
}
export { kstDate };
