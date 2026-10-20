import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { ServiceError } from './errors.mjs';
import { OPINET_DOWNLOAD_URL, decodeKoreanCsv, parseDailyPriceCsv } from './opinet-download.mjs';

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
export function kstDate(now=Date.now()){
  return new Date(now+9*60*60*1000).toISOString().slice(0,10).replaceAll('-','');
}
export function previousKstDate(now=Date.now()){
  return kstDate(now-24*60*60*1000);
}
function safeFilename(value){
  const name=String(value||'').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,120);
  return name||'opinet-daily.csv';
}

export class OpinetBrowserDownloadClient{
  constructor({clock=Date.now,pageReadyTimeoutMs=180000,downloadTimeoutMs=240000}={}){
    this.clock=clock;
    this.pageReadyTimeoutMs=pageReadyTimeoutMs;
    this.downloadTimeoutMs=downloadTimeoutMs;
  }
  async dailyPrices({businessType='station',targetDate=kstDate(this.clock())}={}){
    if(!['station','lpg'].includes(businessType))throw new ServiceError('OPINET_DOWNLOAD_REQUEST_INVALID','전국 일일가격 다운로드 업종을 확인해 주세요.',400);
    if(!/^\d{8}$/.test(String(targetDate)))throw new ServiceError('OPINET_DOWNLOAD_DATE_INVALID','오피넷 일일가격 기준일을 확인해 주세요.',400);

    const chrome=await executablePath();
    const downloadDir=`/tmp/juyuhannun-opinet-${randomUUID()}`;
    await mkdir(downloadDir,{recursive:true});
    let browser;
    let stage='launch';
    const report=(value,extra={})=>console.info(JSON.stringify({event:'opinet_public_download',stage:value,businessType,targetDate,...extra}));

    try{
      browser=await chromium.launch({
        executablePath:chrome,
        headless:true,
        args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--disable-extensions','--disable-background-networking'],
      });
      stage='context';report(stage);
      const context=await browser.newContext({
        userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        locale:'ko-KR',
        acceptDownloads:true,
      });
      const page=await context.newPage();
      page.on('dialog',dialog=>{
        report(`dialog_${dialog.type()}`);
        dialog.accept().catch(()=>{});
      });

      stage='goto';report(stage);
      await page.goto(OPINET_DOWNLOAD_URL,{waitUntil:'domcontentloaded',timeout:120000});
      stage='wait_page';report(stage);
      await page.waitForSelector('.tbl_type20',{state:'visible',timeout:this.pageReadyTimeoutMs});
      await page.waitForFunction(()=>typeof globalThis.fn_Download==='function',undefined,{timeout:this.pageReadyTimeoutMs});

      stage='set_daily_form';report(stage);
      const state=await page.evaluate(({date,businessType})=>{
        const fire=el=>{el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
        const set=(selector,value)=>{
          const el=document.querySelector(selector);
          if(!el)return null;
          el.value=value;fire(el);return el.value;
        };
        const choose=(name,value)=>{
          const el=document.querySelector(`input[name="${name}"][value="${value}"]`);
          if(!el)return false;
          el.checked=true;fire(el);return true;
        };
        choose('rdo3',businessType==='station'?'A':'B');
        choose('rdo4','X');
        for(const selector of ['#span_start_date_picker','input[name="START_DT"]'])set(selector,date);
        for(const selector of ['#span_end_date_picker','input[name="END_DT"]'])set(selector,date);
        for(const selector of ['select[name="SIDO_CD"]','input[name="SIDO_CD"]'])set(selector,'');
        for(const selector of ['select[name="SIGUN_CD"]','input[name="SIGUN_CD"]'])set(selector,'');
        return {
          start:document.querySelector('#span_start_date_picker')?.value??document.querySelector('input[name="START_DT"]')?.value??null,
          end:document.querySelector('#span_end_date_picker')?.value??document.querySelector('input[name="END_DT"]')?.value??null,
        };
      },{date:String(targetDate),businessType});
      if(state.start!==String(targetDate)||state.end!==String(targetDate))throw new ServiceError('OPINET_DOWNLOAD_DATE_SET_FAILED','오피넷 일일가격 다운로드 기준일을 설정하지 못했습니다.');

      stage='invoke_daily_csv';report(stage);
      const downloadPromise=page.waitForEvent('download',{timeout:this.downloadTimeoutMs});
      await page.evaluate(()=>globalThis.fn_Download(6));
      const download=await downloadPromise;
      const failure=await download.failure();
      if(failure)throw new ServiceError('OPINET_DOWNLOAD_FAILED','오피넷 일일가격 CSV 다운로드가 취소되거나 실패했습니다.');

      const suggestedFilename=download.suggestedFilename()||`opinet-daily-${targetDate}.csv`;
      const savePath=`${downloadDir}/${safeFilename(suggestedFilename)}`;
      stage='save_file';report(stage,{suggestedFilename:safeFilename(suggestedFilename)});
      await download.saveAs(savePath);
      const bytes=await readFile(savePath);
      if(bytes.byteLength<10000)throw new ServiceError('OPINET_DOWNLOAD_EMPTY','오피넷 전국 일일가격 CSV가 비어 있거나 예상보다 작습니다.');

      stage='parse_file';report(stage);
      const text=decodeKoreanCsv(bytes);
      if(/^\s*</.test(text.slice(0,200)))throw new ServiceError('OPINET_DOWNLOAD_HTML_RESPONSE','CSV 대신 웹 페이지가 반환되었습니다.');
      const rows=parseDailyPriceCsv(text);
      if(rows.length<1000)throw new ServiceError('OPINET_DOWNLOAD_EMPTY','오피넷 전국 일일가격 CSV의 데이터 행이 충분하지 않습니다.');
      const dates=[...new Set(rows.map(row=>row['기준일자']).filter(Boolean))];
      if(dates.length!==1)throw new ServiceError('OPINET_DOWNLOAD_DATE_MIXED','오피넷 일일가격 CSV의 기준일이 하나로 확인되지 않습니다.');
      if(dates[0]!==String(targetDate))throw new ServiceError('OPINET_DOWNLOAD_DATE_MISMATCH','오피넷 일일가격 CSV 기준일이 요청일과 다릅니다.');

      report('ready',{rows:rows.length,bytes:bytes.byteLength});
      return {rows,bytes:bytes.byteLength,suggestedFilename,sourceDate:dates[0]};
    }catch(error){
      report('failed',{failedAt:stage});
      if(error instanceof ServiceError)throw error;
      throw new ServiceError('OPINET_BROWSER_DOWNLOAD_ERROR',`오피넷 공개 전국 일일가격 CSV 다운로드에 실패했습니다. 단계: ${stage}`);
    }finally{
      if(browser)await browser.close().catch(()=>{});
      await rm(downloadDir,{recursive:true,force:true}).catch(()=>{});
    }
  }
}
