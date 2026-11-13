import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/js/my-page-cloudflare.js',import.meta.url),'utf8');

test('common account starts at SNS selection with no extra login or signup step',()=>{
  const account=html.split('<dialog id="my-page"')[1]?.split('</dialog>')[0]||'';
  assert.ok(account.includes('id="my-providers"'));
  assert.ok(account.includes('처음 이용한다면 SNS 인증 후 회원가입 동의'));
  assert.ok(!account.includes('id="my-login"'));
  assert.ok(!account.includes('id="my-signup"'));
  assert.ok(!account.includes('my-favorites'));
  assert.ok(!account.includes('my-destinations'));
});

test('saved device records are separate from login',()=>{
  const local=html.split('<dialog id="device-page"')[1]?.split('</dialog>')[0]||'';
  assert.ok(html.includes('data-device-records'));
  assert.ok(local.includes('id="my-favorites"'));
  assert.ok(local.includes('id="my-destinations"'));
  assert.ok(ui.includes("account.login(provider)"));
  assert.ok(ui.includes('getAvailableProviders()'));
  assert.ok(!ui.includes('firebase'));
});

test('signed in and guest content are separated',()=>{
  const account=html.split('<dialog id="my-page"')[1]?.split('</dialog>')[0]||'';
  assert.ok(account.includes('id="account-guest"'));
  assert.ok(account.includes('id="account-user"'));
  assert.ok(account.includes('id="my-account-manage"'));
  assert.ok(account.includes('id="my-logout"'));
});
