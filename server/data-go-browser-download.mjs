import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { ServiceError } from './errors.mjs';
import { decodeKoreanCsv } from './opinet-download.mjs';
import { parseStandardStationCsv } from './data-go-stations.mjs';

export const DATA_GO_STANDARD_URL='https://www.data.go.kr/data/15129441/standard.do';
const CANDIDATES=[
 process.env.CHROME_PATH,
 process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
 '/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser',
].filter(Boolean);
async function executablePath(){for(const p of CANDIDATES){try{await access(p);return p;}catch{}}throw new ServiceError('CHROMIUM_NOT_FOUND','전국주유소표준 CSV 다운로드에 사용할 Chromium/Chrome을 찾지 못했습니다.');}
function safeFilename(v){return String(v||'stations.csv').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,120)||'stations.csv';}

export class DataGoStationBrowserClient{
 constructor({downloadTimeoutMs=180000}={}){this.downloadTimeoutMs=downloadTimeoutMs;}
 async download(){
  const chrome=await executablePath(),dir=`/tmp/juyuhannun-data-go-${randomUUID()}`;await mkdir(dir,{recursive:true});
  let browser,stage='launch';
  const report=(value,extra={})=>console.info(JSON.stringify({event:'data_go_station_download',stage:value,...extra}));
  try{
   browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--disable-extensions','--disable-background-networking']});
   const context=await browser.newContext({locale:'ko-KR',acceptDownloads:true,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'});
   const page=await context.newPage();
   page.on('dialog',d=>{report(`dialog_${d.type()}`);d.accept().catch(()=>{});});
   stage='goto';report(stage);await page.goto(DATA_GO_STANDARD_URL,{waitUntil:'domcontentloaded',timeout:120000});
   stage='wait_button';report(stage);await page.waitForSelector('#stdCsvDownloadBtn',{state:'visible',timeout:120000});
   stage='download';report(stage);
   const downloadPromise=page.waitForEvent('download',{timeout:this.downloadTimeoutMs});
   await page.locator('#stdCsvDownloadBtn').click();
   const download=await downloadPromise;
   const failure=await download.failure();if(failure)throw new ServiceError('DATA_GO_DOWNLOAD_FAILED','전국주유소표준 CSV 다운로드가 취소되거나 실패했습니다.');
   const filename=safeFilename(download.suggestedFilename()),path=`${dir}/${filename}`;await download.saveAs(path);
   const bytes=await readFile(path);if(bytes.byteLength<50000)throw new ServiceError('DATA_GO_CSV_EMPTY','전국주유소표준 CSV가 비어 있거나 너무 작습니다.');
   stage='parse';report(stage,{bytes:bytes.byteLength,filename});
   const stations=parseStandardStationCsv(decodeKoreanCsv(bytes));
   report('ready',{rows:stations.length,bytes:bytes.byteLength});
   return {status:'ready',stations,calls:0,bytes:bytes.byteLength,source:'public_csv'};
  }catch(error){
   report('failed',{failedAt:stage});
   if(error instanceof ServiceError)throw error;
   throw new ServiceError('DATA_GO_BROWSER_DOWNLOAD_ERROR',`전국주유소표준 공개 CSV 다운로드에 실패했습니다. 단계: ${stage}`);
  }finally{if(browser)await browser.close().catch(()=>{});await rm(dir,{recursive:true,force:true}).catch(()=>{});}
 }
}
