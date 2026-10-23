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
  const detailModes = new Set(['focus-detail', 'expanded-tools']);
  const focusModes = new Set(['focus-detail', 'expanded-tools', 'map-browse', 'list-sheet', 'list-sheet-expanded', 'full-map']);
  const toolsModes = new Set(['expanded-tools', 'map-browse', 'list-sheet', 'list-sheet-expanded']);
  const listModes = new Set(['list-sheet', 'list-sheet-expanded']);
  const historyKey = 'juyuhannunMapFocus';
  let mode = 'default';
  let previous = null;
  let restoreFrame = 0;
  let layoutFrame = 0;
  let revision = 0;
  let destroyed = false;
  let historyArmed = false;
  let drag = null;
  let listDrag = null;
  let fullReturnMode = 'map-browse';

  function cancelRestore() {
    revision++;
    if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
  }

  function cancelLayout() {
    if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
    layoutFrame = 0;
  }

  function snapshot() {
    if (previous) return;
    previous = {
      expanded: workspace.classList.contains('list-expanded'),
      inert: sidebar.inert,
      listTop: results.scrollTop,
      listLeft: results.scrollLeft,
      sidebarTop: sidebar.scrollTop,
      pageTop: window.scrollY,
      pageLeft: window.scrollX,
      focus: document.activeElement,
    };
  }

  function requestResize() {
    onResize();
    cancelLayout();
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = 0;
      if (!destroyed) onResize();
    });
  }

  function showDetail() {
    if (!detailDialog || detailDialog.open) return;
    if (typeof detailDialog.show === 'function') detailDialog.show();
    else detailDialog.setAttribute('open', '');
  }

  function hideDetail() {
    if (!detailDialog?.open) return;
    if (typeof detailDialog.close === 'function') detailDialog.close();
    else detailDialog.removeAttribute('open');
  }

  function historyObject() {
    return history.state && typeof history.state === 'object' ? history.state : {};
  }

  function armHistory() {
    if (historyArmed) return;
    if (historyObject()[historyKey]) { historyArmed = true; return; }
    try {
      history.pushState({ ...historyObject(), [historyKey]: true }, '', location.href);
      historyArmed = true;
    } catch {
      historyArmed = false;
    }
  }

  function disarmHistoryInPlace() {
    if (!historyArmed && !historyObject()[historyKey]) return;
    try {
      const next = { ...historyObject() };
      delete next[historyKey];
      history.replaceState(next, '', location.href);
    } catch {}
    historyArmed = false;
  }

  function syncButtons() {
    const detailOpen = detailModes.has(mode);
    const expanded = mode === 'expanded-tools';
    const listOpen = listModes.has(mode);

    const toggleLabel = mode === 'full-map' ? '지도 도구 다시 보기' : detailOpen ? '상세 닫고 지도 보기' : '지도 전체 화면';
    toggleButton.innerHTML = `<span class="icon">${icon(mode === 'full-map' ? 'collapse' : 'expand')}</span><span>${mode === 'full-map' ? '도구 보기' : '전체지도'}</span>`;
    toggleButton.setAttribute('aria-pressed', String(mode === 'full-map'));
    toggleButton.setAttribute('aria-label', toggleLabel);
    toggleButton.title = toggleLabel;

    const listLabel = listOpen ? '지도 보기' : '목록 보기';
    listButton.innerHTML = `<span class="icon">${icon(listOpen ? 'map' : 'list')}</span><span>${listLabel}</span>`;
    listButton.setAttribute('aria-expanded', String(listOpen));
    listButton.setAttribute('aria-label', listLabel);
    listButton.setAttribute('aria-controls', 'station-sidebar');
    listButton.title = listLabel;

    if (detailExpandButton) {
      const label = expanded ? '상세 줄이기' : '상세 크게';
      detailExpandButton.innerHTML = `<span class="icon">${icon(expanded ? 'collapse' : 'expand')}</span><span>${label}</span>`;
      detailExpandButton.setAttribute('aria-expanded', String(expanded));
      detailExpandButton.setAttribute('aria-label', expanded ? '상세 패널과 지도 도구 줄이기' : '상세 패널과 지도 도구 크게 보기');
      detailExpandButton.title = label;
    }
  }

  function applyBodyMode(next) {
    const active = focusModes.has(next);
    body.classList.toggle('mobile-map-mode', active);
    body.classList.toggle('mobile-map-focus', next === 'focus-detail');
    body.classList.toggle('mobile-map-expanded', toolsModes.has(next));
    body.classList.toggle('mobile-map-browse', next === 'map-browse');
    body.classList.toggle('mobile-list-sheet', listModes.has(next));
    body.classList.toggle('mobile-list-expanded', next === 'list-sheet-expanded');
    body.classList.toggle('mobile-map-fullscreen', next === 'full-map');
    if (active) workspace.classList.remove('list-expanded');
    sidebar.inert = next === 'focus-detail' || next === 'full-map';
  }

  function setMode(next) {
    cancelRestore();
    snapshot();
    requestResize();
    mode = next;
    applyBodyMode(next);
    syncButtons();
    onModeChange(next);
  }

  function restoreBase({ restoreFocus = true } = {}) {
    cancelRestore();
    cancelLayout();
    const saved = previous;
    previous = null;
    requestResize();
    body.classList.remove('mobile-map-mode','mobile-map-focus','mobile-map-expanded','mobile-map-browse','mobile-list-sheet','mobile-list-expanded','mobile-map-fullscreen');
    workspace.classList.toggle('list-expanded', Boolean(saved?.expanded));
    sidebar.inert = saved?.inert ?? false;
    hideDetail();
    mode = 'default';
    fullReturnMode = 'map-browse';
    disarmHistoryInPlace();
    syncButtons();
    onModeChange(mode);
    if (!saved) return;
    const currentRevision = revision;
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = 0;
      if (destroyed || focusModes.has(mode) || currentRevision !== revision) return;
      window.scrollTo({ left:saved.pageLeft, top:saved.pageTop, behavior:'instant' });
      sidebar.scrollTop = saved.sidebarTop;
      results.scrollTop = saved.listTop;
      results.scrollLeft = saved.listLeft;
      const target = saved.focus;
      if (restoreFocus && !document.querySelector('dialog[open]') && target?.isConnected && !target.closest('[inert]') && target.getClientRects().length) {
        target.focus({ preventScroll:true });
      }
    });
  }

  function enterDetail({ expanded = false } = {}) {
    if (destroyed || !media.matches) return false;
    snapshot();
    armHistory();
    showDetail();
    setMode(expanded ? 'expanded-tools' : 'focus-detail');
    return true;
  }

  function closeDetail({ restoreFocus = false } = {}) {
    if (destroyed) return;
    if (!media.matches) { hideDetail(); return; }
    hideDetail();
    setMode('map-browse');
    if (restoreFocus && focusDockList?.isConnected) focusDockList.focus({preventScroll:true});
  }

  function setDetailMode(next) {
    if (!detailModes.has(next) || !detailDialog?.open) return;
    detailDialog.style.removeProperty('--sheet-drag-y');
    setMode(next);
  }

  function toggleDetailExpanded() {
    if (destroyed || !media.matches || !detailDialog?.open) return;
    setDetailMode(mode === 'expanded-tools' ? 'focus-detail' : 'expanded-tools');
  }

  function openListSheet({ expanded = false } = {}) {
    if (destroyed || !media.matches) return;
    snapshot();
    armHistory();
    hideDetail();
    sidebar.style.removeProperty('--list-drag-y');
    setMode(expanded ? 'list-sheet-expanded' : 'list-sheet');
  }

  function closeListSheet() {
    if (destroyed || !media.matches) return;
    sidebar.style.removeProperty('--list-drag-y');
    setMode('map-browse');
  }

  function onHandlePointerDown(event) {
    if (destroyed || !media.matches || !detailModes.has(mode) || event.button > 0) return;
    drag = { id:event.pointerId, startY:event.clientY, lastY:event.clientY, startedAt:performance.now(), startMode:mode };
    detailHandle?.setPointerCapture?.(event.pointerId);
    detailDialog?.classList.add('is-dragging');
    event.preventDefault();
  }

  function onHandlePointerMove(event) {
    if (!drag || drag.id !== event.pointerId || !detailDialog) return;
    drag.lastY = event.clientY;
    const raw = drag.lastY - drag.startY;
    const offset = drag.startMode === 'expanded-tools' ? Math.max(-24,Math.min(180,raw)) : Math.max(-180,Math.min(140,raw));
    detailDialog.style.setProperty('--sheet-drag-y', offset + 'px');
    event.preventDefault();
  }

  function finishHandleDrag(event, cancelled = false) {
    if (!drag || drag.id !== event.pointerId) return;
    const dy = (event.clientY ?? drag.lastY) - drag.startY;
    const elapsed = Math.max(1, performance.now() - drag.startedAt);
    const velocity = dy / elapsed;
    const startMode = drag.startMode;
    drag = null;
    detailDialog?.classList.remove('is-dragging');
    detailDialog?.style.removeProperty('--sheet-drag-y');
    if (cancelled) return;
    if (startMode === 'focus-detail') {
      if (dy < -58 || velocity < -0.45) setDetailMode('expanded-tools');
      else if (dy > 132 || velocity > 0.72) closeDetail();
      else setDetailMode('focus-detail');
    } else {
      if (dy > 58 || velocity > 0.45) setDetailMode('focus-detail');
      else setDetailMode('expanded-tools');
    }
  }

  function onListPointerDown(event) {
    if (destroyed || !media.matches || !listModes.has(mode) || event.button > 0) return;
    listDrag = { id:event.pointerId, startY:event.clientY, lastY:event.clientY, startedAt:performance.now(), startMode:mode };
    listSheetHandle?.setPointerCapture?.(event.pointerId);
    sidebar.classList.add('is-dragging');
    event.preventDefault();
  }

  function onListPointerMove(event) {
    if (!listDrag || listDrag.id !== event.pointerId) return;
    listDrag.lastY = event.clientY;
    const raw = listDrag.lastY - listDrag.startY;
    const offset = listDrag.startMode === 'list-sheet-expanded' ? Math.max(-20,Math.min(260,raw)) : Math.max(-330,Math.min(180,raw));
    sidebar.style.setProperty('--list-drag-y', offset + 'px');
    event.preventDefault();
  }

  function finishListDrag(event, cancelled = false) {
    if (!listDrag || listDrag.id !== event.pointerId) return;
    const dy = (event.clientY ?? listDrag.lastY) - listDrag.startY;
    const elapsed = Math.max(1, performance.now() - listDrag.startedAt);
    const velocity = dy / elapsed;
    const startMode = listDrag.startMode;
    listDrag = null;
    sidebar.classList.remove('is-dragging');
    sidebar.style.removeProperty('--list-drag-y');
    if (cancelled) return;
    if (startMode === 'list-sheet') {
      if (dy < -56 || velocity < -0.42) setMode('list-sheet-expanded');
      else if (dy > 118 || velocity > 0.65) closeListSheet();
      else setMode('list-sheet');
    } else {
      if (dy > 58 || velocity > 0.42) setMode('list-sheet');
      else setMode('list-sheet-expanded');
    }
  }

  function toggleFullMap() {
    if (destroyed || !media.matches) return;
    if (detailModes.has(mode)) { closeDetail(); return; }
    if (mode === 'full-map') { setMode(fullReturnMode || 'map-browse'); return; }
    if (listModes.has(mode)) { closeListSheet(); return; }
    fullReturnMode = mode === 'map-browse' ? 'map-browse' : 'map-browse';
    setMode('full-map');
  }

  function toggleList() {
    if (destroyed || !media.matches) return;
    if (listModes.has(mode)) closeListSheet();
    else if (focusModes.has(mode)) openListSheet();
    else {
      requestResize();
      workspace.classList.toggle('list-expanded');
      mode = workspace.classList.contains('list-expanded') ? 'list' : 'default';
      syncButtons();
      onModeChange(mode);
    }
  }

  function exit({ showList = false, restoreFocus = true, skipHistory = false } = {}) {
    if (destroyed) return;
    if (showList && focusModes.has(mode)) { openListSheet(); return; }
    if (skipHistory) disarmHistoryInPlace();
    if (focusModes.has(mode)) { restoreBase({restoreFocus}); return; }
    syncButtons();
  }

  function afterLayout(callback) {
    if (typeof callback !== 'function') return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (!destroyed) callback();
    }));
  }

  function onKeyDown(event) {
    if (!media.matches || event.key !== 'Escape') return;
    if (document.querySelector('dialog[open]:not(#detail-dialog)')) return;
    if (mode === 'expanded-tools') { event.preventDefault(); setDetailMode('focus-detail'); return; }
    if (detailModes.has(mode)) { event.preventDefault(); closeDetail(); return; }
    if (mode === 'list-sheet-expanded') { event.preventDefault(); setMode('list-sheet'); return; }
    if (mode === 'list-sheet') { event.preventDefault(); closeListSheet(); return; }
    if (mode === 'full-map') { event.preventDefault(); setMode('map-browse'); return; }
    if (mode === 'map-browse') { event.preventDefault(); restoreBase(); }
  }

  function onPopState() {
    if (!historyArmed) return;
    historyArmed = false;
    if (focusModes.has(mode)) restoreBase({restoreFocus:false});
  }

  function onMediaChange() {
    if (!media.matches) {
      const hadDetail = detailModes.has(mode);
      disarmHistoryInPlace();
      body.classList.remove('mobile-map-mode','mobile-map-focus','mobile-map-expanded','mobile-map-browse','mobile-list-sheet','mobile-list-expanded','mobile-map-fullscreen');
      if (previous) workspace.classList.toggle('list-expanded', previous.expanded);
      sidebar.inert = previous?.inert ?? false;
      sidebar.style.removeProperty('--list-drag-y');
      previous = null;
      mode = 'default';
      if (hadDetail && detailDialog?.open && typeof detailDialog.showModal === 'function') {
        hideDetail();
        detailDialog.showModal();
      }
      requestResize();
    }
    syncButtons();
  }

  if (mapSection.id) toggleButton.setAttribute('aria-controls', mapSection.id);
  toggleButton.addEventListener('click', toggleFullMap);
  listButton.addEventListener('click', toggleList);
  detailExpandButton?.addEventListener('click', toggleDetailExpanded);
  detailHandle?.addEventListener('click', toggleDetailExpanded);
  detailHandle?.addEventListener('pointerdown', onHandlePointerDown);
  detailHandle?.addEventListener('pointermove', onHandlePointerMove);
  detailHandle?.addEventListener('pointerup', event => finishHandleDrag(event));
  detailHandle?.addEventListener('pointercancel', event => finishHandleDrag(event,true));
  listSheetHandle?.addEventListener('click', () => setMode(mode === 'list-sheet-expanded' ? 'list-sheet' : 'list-sheet-expanded'));
  listSheetHandle?.addEventListener('pointerdown', onListPointerDown);
  listSheetHandle?.addEventListener('pointermove', onListPointerMove);
  listSheetHandle?.addEventListener('pointerup', event => finishListDrag(event));
  listSheetHandle?.addEventListener('pointercancel', event => finishListDrag(event,true));
  listSheetClose?.addEventListener('click', closeListSheet);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('popstate', onPopState);
  media.addEventListener('change', onMediaChange);
  syncButtons();

  return {
    enterDetail,
    closeDetail,
    toggleDetailExpanded,
    openListSheet,
    closeListSheet,
    exit,
    afterLayout,
    isActive: () => focusModes.has(mode),
    isDetailOpen: () => detailModes.has(mode),
    isMobile: () => media.matches,
    getMode: () => mode,
    destroy() {
      if (destroyed) return;
      disarmHistoryInPlace();
      hideDetail();
      body.classList.remove('mobile-map-mode','mobile-map-focus','mobile-map-expanded','mobile-map-browse','mobile-list-sheet','mobile-list-expanded','mobile-map-fullscreen');
      cancelRestore();
      cancelLayout();
      destroyed = true;
      toggleButton.removeEventListener('click', toggleFullMap);
      listButton.removeEventListener('click', toggleList);
      detailExpandButton?.removeEventListener('click', toggleDetailExpanded);
      detailHandle?.removeEventListener('click', toggleDetailExpanded);
      detailHandle?.removeEventListener('pointerdown', onHandlePointerDown);
      detailHandle?.removeEventListener('pointermove', onHandlePointerMove);
      listSheetHandle?.removeEventListener('pointerdown', onListPointerDown);
      listSheetHandle?.removeEventListener('pointermove', onListPointerMove);
      listSheetClose?.removeEventListener('click', closeListSheet);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      media.removeEventListener('change', onMediaChange);
    },
  };
}
