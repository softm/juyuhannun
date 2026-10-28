export const BRAND_VISUALS=Object.freeze({
 SKE:{short:'SK',logo:'SK energy',label:'SK에너지',color:'#e4252a',ink:'#fff',image:'./assets/brands/sk-energy.jpg',logoScale:2.05},
 GSC:{short:'GS',logo:'GS Caltex',label:'GS칼텍스',color:'#0a8f67',ink:'#fff',image:'./assets/brands/gs-caltex.png',logoScale:1.28},
 HDO:{short:'HD',logo:'HD',label:'HD현대오일뱅크',color:'#005eb8',ink:'#fff',image:'./assets/brands/hd-hyundai-oilbank.svg',logoScale:1.2},
 SOL:{short:'S',logo:'S-OIL',label:'S-OIL',color:'#f4c400',ink:'#b40016',image:'./assets/brands/s-oil.png',logoScale:1.25},
 RTE:{short:'알',logo:'알뜰',label:'알뜰주유소',color:'#f39a19',ink:'#fff'},
 RTX:{short:'고',logo:'알뜰',label:'고속도로 알뜰',color:'#3467b1',ink:'#fff'},
 NHO:{short:'NH',logo:'NH',label:'농협 알뜰',color:'#178445',ink:'#fff'},
 ETC:{short:'자',logo:'자가',label:'자가상표',color:'#64748b',ink:'#fff'},
 E1G:{short:'E1',logo:'E1',label:'E1',color:'#ef6c22',ink:'#fff',image:'./assets/brands/e1.png',logoScale:1.65},
 SKG:{short:'SK',logo:'SK gas',label:'SK가스',color:'#e4252a',ink:'#fff',image:'./assets/brands/sk-energy.jpg',logoScale:2.05}
});
export function brandVisual(code,label='상표 미확인'){return BRAND_VISUALS[code]||{short:'?',logo:label||'기타',label:label||'상표 미확인',color:'#64748b',ink:'#fff'};}
