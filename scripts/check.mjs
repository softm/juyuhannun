import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let errors=0;
async function walk(path){const entries=await readdir(path,{withFileTypes:true});let files=[];for(const e of entries){if(['node_modules','dist','.cache','.git'].includes(e.name))continue;const p=resolve(path,e.name);files.push(...(e.isDirectory()?await walk(p):[p]));}return files;}
const files=await walk(root);
for(const file of files){if(!/\.(mjs|js)$/.test(file))continue;const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){console.error(result.stderr);errors++;}}
const html=await readFile(resolve(root,'public/index.html'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length){console.error('Duplicate HTML ids');errors++;}
if(/<\/option\s+/.test(html)){console.error('Invalid closing option tag');errors++;}
for(const m of html.matchAll(/(?:href|src)="(\.\/[^"?#]+)(?:[?#][^"]*)?"/g)){if(m[1]==='./')continue;try{await readFile(resolve(root,'public',m[1]));}catch{console.error(`Missing asset: ${m[1]}`);errors++;}}
const data=JSON.parse(await readFile(resolve(root,'public/data/stations.json'),'utf8'));
if(!['ready','partial','awaiting_credentials','error'].includes(data.status)||!Array.isArray(data.stations)){console.error('Invalid stations envelope');errors++;}
for(const station of data.stations){if(!station.id||!station.name||!Number.isFinite(station.lat)||!Number.isFinite(station.lng)){console.error('Invalid station identity / coordinate');errors++;}for(const p of Object.values(station.prices||{})){if(p.price!==null&&!(typeof p.price==='number'&&Number.isFinite(p.price)&&p.price>0)){console.error('Invalid fuel price');errors++;}}}
for(const file of files.filter(f=>f.includes('/public/')&&/\.(js|json|html|md)$/.test(f))){const text=await readFile(file,'utf8');if(/(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text)){console.error('Credential-like value in public asset');errors++;}}
console.log(`Checked ${files.length} files: syntax, asset paths, HTML ids/options, data shape, public credential scan.`);
if(errors)process.exitCode=1;
