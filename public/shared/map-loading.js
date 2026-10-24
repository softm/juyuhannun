const STAGES=Object.freeze({
  map:{step:1,title:'지도를 준비하고 있어요',detail:'지도 서비스를 연결하고 있습니다.'},
  location:{step:2,title:'현재 위치를 확인하고 있어요',detail:'위치 권한을 확인한 뒤 가까운 지역으로 이동합니다.'},
  data:{step:3,title:'주유소 자료를 불러오고 있어요',detail:'가격과 위치 정보를 함께 확인합니다.'},
  markers:{step:4,title:'지도에 주유소를 표시하고 있어요',detail:'현재 화면에 맞는 마커를 배치하고 있습니다.'},
});

export function createMapLoadingController(element,{stages=STAGES}={}){
  let current='map',closed=false;
  if(!element)return {stage(){},complete(){},error(){},show(){}};

  element.innerHTML='<div class="map-loading-card"><span class="map-loading-spinner" aria-hidden="true"></span><div class="map-loading-copy"><strong></strong><small></small><div class="map-loading-progress" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div></div>';
  element.setAttribute('role','status');
  element.setAttribute('aria-live','polite');
  element.setAttribute('aria-busy','true');

  const title=element.querySelector('strong'),detail=element.querySelector('small');
  const dots=[...element.querySelectorAll('.map-loading-progress i')];

  function render(name,override={}){
    current=name;
    const config={...(stages[name]||stages.map),...override};
    title.textContent=config.title||'지도를 준비하고 있어요';
    detail.textContent=config.detail||'잠시만 기다려 주세요.';
    const step=Math.max(1,Math.min(dots.length,Number(config.step)||1));
    dots.forEach((dot,index)=>{
      dot.classList.toggle('done',index<step-1);
      dot.classList.toggle('active',index===step-1);
    });
    element.dataset.stage=name;
  }

  function show(name=current,override={}){
    closed=false;element.hidden=false;element.classList.remove('is-complete','is-error');
    element.setAttribute('aria-busy','true');render(name,override);
  }

  function stage(name,override={}){
    if(closed)show(name,override);else render(name,override);
  }

  function complete(message='주유소 표시를 완료했습니다.'){
    closed=true;element.classList.add('is-complete');element.classList.remove('is-error');
    element.setAttribute('aria-busy','false');
    title.textContent=message;detail.textContent='지도를 바로 사용할 수 있습니다.';
    dots.forEach(dot=>{dot.classList.add('done');dot.classList.remove('active');});
    const reduce=matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    setTimeout(()=>{if(closed)element.hidden=true;},reduce?0:320);
  }

  function error(message='지도를 준비하지 못했습니다.'){
    closed=false;element.hidden=false;element.classList.add('is-error');element.classList.remove('is-complete');
    element.setAttribute('aria-busy','false');title.textContent=message;detail.textContent='잠시 후 다시 시도해 주세요.';
  }

  show('map');
  return {stage,complete,error,show,getStage:()=>current};
}
