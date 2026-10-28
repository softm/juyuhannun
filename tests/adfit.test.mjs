import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('주유한눈 상세 광고는 전용 PC·모바일 단위와 운영 경로만 사용한다',async()=>{
  const config=await read('public/adfit-config.js');
  assert.match(config,/hostname:'softm\.github\.io'/);
  assert.match(config,/pathname:'\/juyuhannun\/'/);
  assert.match(config,/desktop:\{unit:'DAN-HpBNRNLNOH0TTRji',width:728,height:90\}/);
  assert.match(config,/mobile:\{unit:'DAN-VR0n4syKiJiIKlN7',width:320,height:100\}/);
  assert.match(config,/bottom:\{unit:'DAN-VR0n4syKiJiIKlN7',width:320,height:100\}/);
  assert.match(config,/AdMobNative\\\/1/);
});

test('메인과 평균유가 화면은 세션 상태를 유지하는 공통 하단 접힘 광고를 사용한다',async()=>{
  const [app,energy,adfit,styles]=await Promise.all([read('public/js/app.js'),read('public/js/energy.js'),read('public/js/adfit.js'),read('public/styles.css')]);
  assert.match(app,/mountBottomAd\(\)/);
  assert.match(energy,/mountBottomAd\(\)/);
  assert.match(adfit,/juyuhannun:ad-bottom:expanded:v1/);
  assert.match(adfit,/하단 광고 접기/);
  assert.match(adfit,/하단 광고 펼치기/);
  assert.match(adfit,/pointerdown/);
  assert.match(adfit,/dragDistance>=36/);
  assert.match(styles,/\.juyu-bottom-ad-grip/);
  assert.match(styles,/touch-action:none/);
  assert.match(adfit,/sessionStorage\.setItem/);
  assert.match(adfit,/state==='empty'/);
  assert.match(styles,/--juyu-bottom-ad-space/);
  assert.match(styles,/\.juyu-bottom-ad\{/);
});

test('상세 하단 광고는 지연 요청과 실패 시 공간 반환을 유지한다',async()=>{
  const [app,adfit]=await Promise.all([read('public/js/app.js'),read('public/js/adfit.js')]);
  assert.match(app,/id="station-detail-ad-host"/);
  assert.match(app,/mountStationDetailAd\(\$\('station-detail-ad-host'\)\)/);
  assert.match(adfit,/new IntersectionObserver/);
  assert.match(adfit,/body\.clientWidth>=slot\.width/);
  assert.match(adfit,/dataset\.adOnfail/);
  assert.match(adfit,/body\.replaceChildren\(\)/);
  assert.match(adfit,/if\(!nodes\.has\(key\)\)nodes\.set\(key,createAdNode\(slot\)\)/);
});
