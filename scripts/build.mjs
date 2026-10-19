import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
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
await writeFile(`${root}dist/.nojekyll`,'');
console.log('Built static site in dist/ (publish its contents at the site root).');
