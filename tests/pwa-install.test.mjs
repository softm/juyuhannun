import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../public/',import.meta.url);

test('PWA manifest and service worker expose an installable standalone web app',async()=>{
 const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',root),'utf8'));
 const app=await readFile(new URL('js/app.js',root),'utf8');
 const worker=await readFile(new URL('sw.js',root),'utf8');
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.id,'./');
 assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'));
 assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'));
 assert.ok(manifest.icons.some(icon=>icon.purpose.includes('maskable')));
 assert.match(app,/beforeinstallprompt/);
 assert.match(app,/serviceWorker\.register\('\.\/sw\.js'/);
 assert.match(worker,/request\.mode==='navigate'/);
 assert.match(worker,/url\.pathname\.includes\('\/data\/'\)/);
});

test('the web UI offers install entry points and browser-specific guidance',async()=>{
 const html=await readFile(new URL('index.html',root),'utf8');
 assert.ok((html.match(/data-install-app/g)||[]).length>=2);
 assert.match(html,/id="install-dialog"/);
 assert.match(html,/id="install-dialog-action"/);
});
