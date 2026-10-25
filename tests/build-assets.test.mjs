import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const execFileAsync=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));

test('built HTML references only assets included in the immutable app directory',async()=>{
 await execFileAsync(process.execPath,['scripts/build.mjs'],{cwd:root});
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 const revision=html.match(/<html lang="ko" data-build="([a-f0-9]{12})">/)?.[1];
 assert.ok(revision,'the build revision must be written to HTML');
 const paths=[...html.matchAll(/(?:href|src)="(\.\/_app\/[^"?#]+)"/g)].map(match=>match[1].slice(2));
 assert.ok(paths.some(path=>path.endsWith('/js/app.js')),'the application module must be versioned');
 for(const path of paths)assert.ok((await stat(new URL(`../dist/${path}`,import.meta.url))).isFile(),`${path} must exist in dist`);
 for(const path of ['js/app.js','js/adfit.js','adfit-config.js']){
  assert.ok((await stat(new URL(`../dist/_app/${revision}/${path}`,import.meta.url))).isFile(),`${path} must exist in the immutable app directory`);
 }
});
