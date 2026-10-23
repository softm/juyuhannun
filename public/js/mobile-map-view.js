export function setupMobileMapView({
  workspace,
  sidebar,
  mapSection,
  results,
  toggleButton,
  listButton,
  detailDialog = null,
  detailExpandButton = null,
  detailHandle = null,
  listSheetHandle = null,
  listSheetClose = null,
  focusDock = null,
  focusDockList = null,
  onResize = () => {},
  onModeChange = () => {},
  icon,
}) {
  const media = window.matchMedia('(max-width:1000px)');
  const body = document.body;
  const detailModes = new Set(['focus-detail','expanded-tools']);
  const mapModes = new Set(['map-browse','map-collapsed']);
  const listModes = new Set(['list-sheet','list-sheet-expanded']);
  const focusModes = new Set([...detailModes,...mapModes,...listModes]);
  const toolsModes = new Set(['map-browse','expanded-tools','list-sheet','list-sheet-expanded']);
  const historyKey = 'juyuhannunMapFocus';
  let mode = media.matches ? 'map-browse' : 'default';
  let previous = null;
  let restoreFrame = 0;
  let layoutFrame = 0;
  let revision = 0;
  let destroyed = false;
  let historyArmed = false;
  let drag = null;
  let suppressDetailHandleClick = false;
  let listDrag = null;
  let detailReturnMode = 'map-browse';

  function cancelRestore(){revision++;if(restoreFrame)cancelAnimationFrame(restoreFrame);restoreFrame=0;}
  function cancelLayout(){if(layoutFrame)cancelAnimationFrame(layoutFrame);layoutFrame=0;}
  function snapshot(){if(previous)return;previous={expanded:workspace.classList.contains('list-expanded'),inert:sidebar.inert,listTop:results.scrollTop,listLeft:results.scrollLeft,sidebarTop:sidebar.scrollTop,pageTop:scrollY,pageLeft:scrollX,focus:document.activeElement};}
  function requestResize(){onResize();cancelLayout();layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;if(!destroyed)onResize();});}
  function showDetail(){if(!detailDialog||detailDialog.open)return;if(typeof detailDialog.show==='function')detailDialog.show();else detailDialog.setAttribute('open','');}
  function hideDetail(){if(!detailDialog?.open)return;if(typeof detailDialog.close==='function')detailDialog.close();else detailDialog.removeAttribute('open');}
  function historyObject(){return history.state&&typeof history.state==='object'?history.state:{};}
  function armHistory(){if(historyArmed)return;if(historyObject()[historyKey]){historyArmed=true;return;}try{history.pushState({...historyObject(),[historyKey]:true},'',location.href);historyArmed=true;}catch{historyArmed=false;}}
  function disarmHistoryInPlace(){if(!historyArmed&&!historyObject()[historyKey])return;try{const next={...historyObject()};delete next[historyKey];history.replaceState(next,'',location.href);}catch{}historyArmed=false;}

  function syncButtons(){
    const collapsed=mode==='map-collapsed';
    const expandedMap=mode==='map-browse';
    toggleButton.innerHTML=`<span class="icon">${icon(collapsed?'expand':'collapse')}</span><span>${collapsed?'확장':'축소'}</span>`;
    toggleButton.setAttribute('aria-pressed',String(expandedMap));
    toggleButton.setAttribute('aria-label',collapsed?'지도 도구 펼치기':'지도 도구 축소');
    toggleButton.title=collapsed?'지도 도구 펼치기':'지도 도구 축소';
    const listOpen=listModes.has(mode);
    listButton.innerHTML=`<span class="icon">${icon(listOpen?'map':'list')}</span><span>${listOpen?'지도 보기':'목록 보기'}</span>`;
    listButton.setAttribute('aria-expanded',String(listOpen));
    if(detailExpandButton){
      const expanded=mode==='expanded-tools';
      const label=expanded?'상세 줄이기':'상세 크게';
      detailExpandButton.innerHTML=`<span class="icon">${icon(expanded?'collapse':'expand')}</span><span>${label}</span>`;
      detailExpandButton.setAttribute('aria-expanded',String(expanded));
      detailExpandButton.setAttribute('aria-label',expanded?'상세와 지도 도구 줄이기':'상세와 지도 도구 크게 보기');
      detailExpandButton.title=label;
    }
  }

  function applyBodyMode(next){
    const active=focusModes.has(next);
    body.classList.toggle('mobile-map-mode',active);
    body.classList.toggle('mobile-map-focus',next==='focus-detail');
    body.classList.toggle('mobile-map-expanded',toolsModes.has(next));
    body.classList.toggle('mobile-map-browse',next==='map-browse');
    body.classList.toggle('mobile-map-collapsed',next==='map-collapsed');
    body.classList.toggle('mobile-list-sheet',listModes.has(next));
    body.classList.toggle('mobile-list-expanded',next==='list-sheet-expanded');
    if(active)workspace.classList.remove('list-expanded');
    sidebar.inert=next==='focus-detail'||next==='map-collapsed';
  }

  function setMode(next){cancelRestore();snapshot();mode=next;applyBodyMode(next);syncButtons();requestResize();onModeChange(next);}

  function startMobileExpanded(){
    if(destroyed||!media.matches)return false;
    snapshot();
    hideDetail();
    setMode('map-browse');
    return true;
  }

  function enterDetail({expanded=false}={}){
    if(destroyed||!media.matches)return false;
    snapshot();armHistory();detailReturnMode=mode==='map-collapsed'?'map-collapsed':'map-browse';showDetail();setMode(expanded?'expanded-tools':'focus-detail');return true;
  }
  function closeDetail(){if(destroyed)return;if(!media.matches){hideDetail();return;}hideDetail();disarmHistoryInPlace();setMode(detailReturnMode||'map-browse');}
  function clearLiveDetailHeight(){
    if(!detailDialog)return;
    detailDialog.style.removeProperty('--sheet-live-height');
    detailDialog.style.removeProperty('height');
    detailDialog.style.removeProperty('max-height');
    detailDialog.style.removeProperty('min-height');
  }
  function applyLiveDetailHeight(height){
    if(!detailDialog)return;
    const value=Math.max(1,Math.round(Number(height)||0))+'px';
    detailDialog.style.setProperty('--sheet-live-height',value);
    // The sheet CSS has several historical max-height rules. Inline !important keeps
    // the panel physically attached to the finger on Safari/Chrome during the drag.
    detailDialog.style.setProperty('height',value,'important');
    detailDialog.style.setProperty('max-height',value,'important');
    detailDialog.style.setProperty('min-height',value,'important');
  }
  function setDetailMode(next){if(!detailModes.has(next)||!detailDialog?.open)return;clearLiveDetailHeight();setMode(next);}
  function toggleDetailExpanded(){if(destroyed||!media.matches||!detailDialog?.open)return;setDetailMode(mode==='expanded-tools'?'focus-detail':'expanded-tools');}

  function openListSheet({expanded=false}={}){if(destroyed||!media.matches)return;snapshot();armHistory();hideDetail();sidebar.style.removeProperty('--list-drag-y');setMode(expanded?'list-sheet-expanded':'list-sheet');}
  function closeListSheet(){if(destroyed||!media.matches)return;sidebar.style.removeProperty('--list-drag-y');disarmHistoryInPlace();setMode('map-browse');}

  function toggleMapChrome(){
    if(destroyed||!media.matches)return;
    if(mode==='map-browse'){setMode('map-collapsed');return;}
    if(mode==='map-collapsed'){setMode('map-browse');return;}
    if(listModes.has(mode)){closeListSheet();return;}
    if(detailModes.has(mode)){toggleDetailExpanded();}
  }

  function onHandlePointerDown(event){
    if(destroyed||!media.matches||!detailModes.has(mode)||event.button>0)return;
    const rect=detailDialog?.getBoundingClientRect();
    suppressDetailHandleClick=false;
    drag={id:event.pointerId,startY:event.clientY,lastY:event.clientY,startedAt:performance.now(),startMode:mode,startHeight:rect?.height||0};
    detailHandle?.setPointerCapture?.(event.pointerId);
    detailDialog?.classList.add('is-dragging');
    event.preventDefault();
  }
  function onHandlePointerMove(event){
    if(!drag||drag.id!==event.pointerId||!detailDialog)return;
    drag.lastY=event.clientY;
    const raw=drag.lastY-drag.startY;
    const viewportHeight=Math.max(320,window.innerHeight||document.documentElement.clientHeight||800);
    const compactHeight=viewportHeight*.58;
    const expandedHeight=viewportHeight*.82;
    const minHeight=viewportHeight*.34;
    const maxHeight=viewportHeight*.9;
    const base=drag.startHeight||(drag.startMode==='expanded-tools'?expandedHeight:compactHeight);
    const next=Math.max(minHeight,Math.min(maxHeight,base-raw));
    applyLiveDetailHeight(next);
    if(Math.abs(raw)>8)suppressDetailHandleClick=true;
    requestResize();
    event.preventDefault();
  }
  function finishHandleDrag(event,cancelled=false){
    if(!drag||drag.id!==event.pointerId)return;
    const dy=(event.clientY??drag.lastY)-drag.startY,elapsed=Math.max(1,performance.now()-drag.startedAt),velocity=dy/elapsed,startMode=drag.startMode,moved=Math.abs(dy)>8;
    drag=null;
    detailDialog?.classList.remove('is-dragging');
    clearLiveDetailHeight();
    if(moved){suppressDetailHandleClick=true;setTimeout(()=>{suppressDetailHandleClick=false;},0);}
    if(cancelled)return;
    if(startMode==='focus-detail'){
      if(dy<-58||velocity<-.45)setDetailMode('expanded-tools');
      else if(dy>132||velocity>.72)closeDetail();
      else setDetailMode('focus-detail');
    }else{
      if(dy>58||velocity>.45)setDetailMode('focus-detail');
      else setDetailMode('expanded-tools');
    }
  }
  function onHandleClick(event){
    if(suppressDetailHandleClick){event.preventDefault();event.stopPropagation();return;}
    toggleDetailExpanded();
  }

  function onListPointerDown(event){if(destroyed||!media.matches||!listModes.has(mode)||event.button>0)return;listDrag={id:event.pointerId,startY:event.clientY,lastY:event.clientY,startedAt:performance.now(),startMode:mode};listSheetHandle?.setPointerCapture?.(event.pointerId);sidebar.classList.add('is-dragging');event.preventDefault();}
  function onListPointerMove(event){if(!listDrag||listDrag.id!==event.pointerId)return;listDrag.lastY=event.clientY;const raw=listDrag.lastY-listDrag.startY,offset=listDrag.startMode==='list-sheet-expanded'?Math.max(-20,Math.min(260,raw)):Math.max(-330,Math.min(180,raw));sidebar.style.setProperty('--list-drag-y',offset+'px');event.preventDefault();}
  function finishListDrag(event,cancelled=false){if(!listDrag||listDrag.id!==event.pointerId)return;const dy=(event.clientY??listDrag.lastY)-listDrag.startY,elapsed=Math.max(1,performance.now()-listDrag.startedAt),velocity=dy/elapsed,startMode=listDrag.startMode;listDrag=null;sidebar.classList.remove('is-dragging');sidebar.style.removeProperty('--list-drag-y');if(cancelled)return;if(startMode==='list-sheet'){if(dy<-56||velocity<-.42)setMode('list-sheet-expanded');else if(dy>118||velocity>.65)closeListSheet();else setMode('list-sheet');}else{if(dy>58||velocity>.42)setMode('list-sheet');else setMode('list-sheet-expanded');}}

  function toggleList(){if(destroyed||!media.matches)return;if(listModes.has(mode))closeListSheet();else if(focusModes.has(mode))openListSheet();}
  function exit({restoreFocus=true,skipHistory=false}={}){if(destroyed)return;if(skipHistory)disarmHistoryInPlace();if(!media.matches)return;hideDetail();sidebar.style.removeProperty('--list-drag-y');setMode('map-browse');if(restoreFocus&&focusDockList?.isConnected)focusDockList.focus({preventScroll:true});}
  function afterLayout(callback){if(typeof callback!=='function')return;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!destroyed)callback();}));}
  function onKeyDown(event){if(!media.matches||event.key!=='Escape')return;if(document.querySelector('dialog[open]:not(#detail-dialog)'))return;if(mode==='expanded-tools'){event.preventDefault();setDetailMode('focus-detail');return;}if(detailModes.has(mode)){event.preventDefault();closeDetail();return;}if(mode==='list-sheet-expanded'){event.preventDefault();setMode('list-sheet');return;}if(mode==='list-sheet'){event.preventDefault();closeListSheet();return;}if(mode==='map-browse'){event.preventDefault();setMode('map-collapsed');return;}if(mode==='map-collapsed'){event.preventDefault();setMode('map-browse');}}
  function onPopState(){if(!historyArmed)return;historyArmed=false;if(detailModes.has(mode)){hideDetail();setMode(detailReturnMode||'map-browse');}else if(listModes.has(mode))setMode('map-browse');}
  function onMediaChange(){if(media.matches){startMobileExpanded();return;}disarmHistoryInPlace();hideDetail();body.classList.remove('mobile-map-mode','mobile-map-focus','mobile-map-expanded','mobile-map-browse','mobile-map-collapsed','mobile-list-sheet','mobile-list-expanded');sidebar.inert=false;sidebar.style.removeProperty('--list-drag-y');mode='default';requestResize();syncButtons();}

  const onWindowPointerUp=e=>finishHandleDrag(e);
  const onWindowPointerCancel=e=>finishHandleDrag(e,true);

  toggleButton.addEventListener('click',toggleMapChrome);
  listButton.addEventListener('click',toggleList);
  detailExpandButton?.addEventListener('click',toggleDetailExpanded);
  detailHandle?.addEventListener('click',onHandleClick);
  detailHandle?.addEventListener('pointerdown',onHandlePointerDown);
  // Keep tracking after the finger leaves the 18px handle. Pointer capture is not
  // consistently reliable inside <dialog> on older mobile WebKit.
  window.addEventListener('pointermove',onHandlePointerMove,{passive:false});
  window.addEventListener('pointerup',onWindowPointerUp);
  window.addEventListener('pointercancel',onWindowPointerCancel);
  listSheetHandle?.addEventListener('click',()=>setMode(mode==='list-sheet-expanded'?'list-sheet':'list-sheet-expanded'));
  listSheetHandle?.addEventListener('pointerdown',onListPointerDown);
  listSheetHandle?.addEventListener('pointermove',onListPointerMove);
  listSheetHandle?.addEventListener('pointerup',e=>finishListDrag(e));
  listSheetHandle?.addEventListener('pointercancel',e=>finishListDrag(e,true));
  listSheetClose?.addEventListener('click',closeListSheet);
  document.addEventListener('keydown',onKeyDown);
  window.addEventListener('popstate',onPopState);
  media.addEventListener('change',onMediaChange);
  if(media.matches)startMobileExpanded();else syncButtons();

  return {startMobileExpanded,enterDetail,closeDetail,toggleDetailExpanded,openListSheet,closeListSheet,toggleMapChrome,exit,afterLayout,isActive:()=>focusModes.has(mode),isDetailOpen:()=>detailModes.has(mode),isMobile:()=>media.matches,getMode:()=>mode,destroy(){if(destroyed)return;disarmHistoryInPlace();hideDetail();body.classList.remove('mobile-map-mode','mobile-map-focus','mobile-map-expanded','mobile-map-browse','mobile-map-collapsed','mobile-list-sheet','mobile-list-expanded');destroyed=true;toggleButton.removeEventListener('click',toggleMapChrome);listButton.removeEventListener('click',toggleList);detailExpandButton?.removeEventListener('click',toggleDetailExpanded);detailHandle?.removeEventListener('click',onHandleClick);detailHandle?.removeEventListener('pointerdown',onHandlePointerDown);window.removeEventListener('pointermove',onHandlePointerMove);window.removeEventListener('pointerup',onWindowPointerUp);window.removeEventListener('pointercancel',onWindowPointerCancel);listSheetHandle?.removeEventListener('pointerdown',onListPointerDown);listSheetHandle?.removeEventListener('pointermove',onListPointerMove);listSheetClose?.removeEventListener('click',closeListSheet);document.removeEventListener('keydown',onKeyDown);window.removeEventListener('popstate',onPopState);media.removeEventListener('change',onMediaChange);}};
}
