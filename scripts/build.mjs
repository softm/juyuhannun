import {cp,mkdir,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await rm(`${root}dist`,{recursive:true,force:true});
await mkdir(`${root}dist`,{recursive:true});
await cp(`${root}public`,`${root}dist`,{recursive:true});
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
for(const path of ['js','shared','config.js','styles.css'])await cp(`${root}dist/${path}`,`${versionRoot}/${path}`,{recursive:true});
let html=await readFile(`${root}dist/index.html`,'utf8');
html=html.replace('href="./styles.css"',`href="./_app/${revision}/styles.css"`).replace('src="./js/app.js"',`src="./_app/${revision}/js/app.js"`).replace('<html lang="ko">',`<html lang="ko" data-build="${revision}">`);
await writeFile(`${root}dist/index.html`,html);
await writeFile(`${root}dist/.nojekyll`,'');
console.log(`Built static site in dist/; version ${revision} (publish its contents at the site root).`);
