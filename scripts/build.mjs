import {cp,mkdir,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {writeDataStatus} from './data-status.mjs';
import {gzipSync} from 'node:zlib';
const root=fileURLToPath(new URL('../',import.meta.url));
await rm(`${root}dist`,{recursive:true,force:true});
await mkdir(`${root}dist`,{recursive:true});
await cp(`${root}public`,`${root}dist`,{recursive:true});
await writeDataStatus(`${root}dist/data`);
for(const name of ['stations','nationwide/latest','nationwide/search']){
 const path=`${root}dist/data/${name}.json`;
 const compact=JSON.stringify(JSON.parse(await readFile(path,'utf8')));
 await writeFile(`${path}.gz`,gzipSync(compact,{level:9}));
}
if(process.env.PUBLIC_API_BASE){
 const u=new URL(process.env.PUBLIC_API_BASE);
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('PUBLIC_API_BASE must be an HTTPS API base without credentials or parameters.');
 const {APP_CONFIG}=await import('../public/config.js');
 const config={...APP_CONFIG,apiBase:u.href.replace(/\/$/,'')};
 await writeFile(`${root}dist/config.js`,`export const APP_CONFIG = ${JSON.stringify(config,null,2)};\nglobalThis.APP_CONFIG=APP_CONFIG;\n`);
}
// Immutable code paths keep old CDN/browser assets from mixing with a new build.
// Price data is intentionally outside this namespace and fetched with no-store.
const hash=createHash('sha256');
const immutablePaths=['js','shared','config.js','adfit-config.js',...(await readdir(`${root}dist`)).filter(name=>name.endsWith('.css'))];
hash.update('immutable-paths\0').update(immutablePaths.join('\0')).update('\0');
async function hashCode(directory,prefix=''){
 for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name==='data'||entry.name==='_app')continue;
  const path=`${directory}/${entry.name}`;
  if(entry.isDirectory())await hashCode(path,`${prefix}${entry.name}/`);
  else hash.update(`${prefix}${entry.name}\0`).update(await readFile(path));
 }
}
await hashCode(`${root}dist`);
const revision=hash.digest('hex').slice(0,12),versionRoot=`${root}dist/_app/${revision}`;
await mkdir(versionRoot,{recursive:true});
for(const path of immutablePaths)await cp(`${root}dist/${path}`,`${versionRoot}/${path}`,{recursive:true});
for(const name of (await readdir(`${root}dist`)).filter(name=>name.endsWith('.html'))){
 let html=await readFile(`${root}dist/${name}`,'utf8');
 html=html.replace(/(href|src)="\.\/((?:js\/[^\"]+\.js)|(?:[^\"/]+\.css))"/g,(_,attr,path)=>`${attr}="./_app/${revision}/${path}"`).replace('<html lang="ko">',`<html lang="ko" data-build="${revision}">`);
 await writeFile(`${root}dist/${name}`,html);
}
await writeFile(`${root}dist/.nojekyll`,'');
console.log(`Built static site in dist/; version ${revision} (publish its contents at the site root).`);
