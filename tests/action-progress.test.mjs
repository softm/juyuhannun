import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);const read=path=>readFile(new URL(path,root),'utf8');
test('공통 진행 표시가 페이지 이동과 버튼 행위를 모두 감지한다',async()=>{
 const [script,css,index,energy,status]=await Promise.all([read('public/shared/action-progress.js'),read('public/action-progress.css'),read('public/index.html'),read('public/energy.html'),read('public/data-status.html')]);
 assert.match(script,/closest\('a\[href\],button,\[role="button"\]'\)/);assert.match(script,/document\.addEventListener\('submit'/);assert.match(script,/aria-valuenow/);assert.match(script,/aria-valuetext/);assert.match(script,/MIN_VISIBLE_MS=900/);assert.match(css,/\.action-progress\{/);assert.match(css,/linear-gradient\(90deg,#19c894/);assert.match(css,/actionProgressGlow/);assert.match(css,/\.action-progress-status\{/);
 for(const html of [index,energy,status])assert.match(html,/action-progress\.css/);
});
test('비동기 자료 조회는 완료 시점에 진행 표시를 닫는다',async()=>{for(const path of ['public/js/app.js','public/js/energy.js','public/js/data-status.js']){const source=await read(path);assert.match(source,/beginActionProgress/);assert.match(source,/finishProgress/);}});
