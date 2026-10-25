// 주유한눈 전용 Kakao AdFit Web 매체(NDW). 다른 서비스에서 광고 단위 ID를 재사용하지 않는다.
export const NATIVE_ADS=/\bAdMobNative\/1\b/.test(globalThis.navigator?.userAgent||'');

export const ADFIT_CONFIG=Object.freeze({
  enabled:!NATIVE_ADS,
  hostname:'softm.github.io',
  pathname:'/juyuhannun/',
  script:'https://t1.kakaocdn.net/kas/static/ba.min.js',
  detail:{
    desktop:{unit:'DAN-HpBNRNLNOH0TTRji',width:728,height:90},
    mobile:{unit:'DAN-VR0n4syKiJiIKlN7',width:320,height:100}
  }
});
