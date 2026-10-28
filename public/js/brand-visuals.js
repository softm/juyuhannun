export const BRAND_VISUALS=Object.freeze({
 SKE:{short:'SK',label:'SK에너지'},GSC:{short:'GS',label:'GS칼텍스'},HDO:{short:'HD',label:'HD현대오일뱅크'},SOL:{short:'S',label:'S-OIL'},RTE:{short:'알',label:'알뜰주유소'},RTX:{short:'고',label:'고속도로 알뜰'},NHO:{short:'NH',label:'농협 알뜰'},ETC:{short:'자',label:'자가상표'},E1G:{short:'E1',label:'E1'},SKG:{short:'SK',label:'SK가스'}
});
export function brandVisual(code,label='상표 미확인'){return BRAND_VISUALS[code]||{short:'?',label:label||'상표 미확인'};}
