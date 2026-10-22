export function setupMobileMapView({
  workspace,
  sidebar,
  mapSection,
  results,
  toggleButton,
  listButton,
  detailDialog = null,
  detailExpandButton = null,
  onResize = () => {},
  onModeChange = () => {},
  icon,
}) {
  const media = window.matchMedia('(max-width:1000px)');
  const body = document.body;
  const focusModes = new Set(['focus-detail', 'expanded-tools']);
  const mapModes = new Set(['focus-detail', 'expanded-tools', 'full-map']);
  const historyKey = 'juyuhannunMapFocus';
  let mode = 'default';
  let fullReturnMode = 'default';
  let previous = null;
  let restoreFrame = 0;
  let layoutFrame = 0;
  let revision = 0;
  let destroyed = false;
  let historyArmed = false;

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
    if (historyObject()[historyKey]) {
      historyArmed = true;
      return;
    }
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
    const full = mode === 'full-map';
    const expandedList = !mapModes.has(mode) && workspace.classList.contains('list-expanded');
    const toggleLabel = full ? '지도 전체 화면 닫기' : '지도 전체 화면';
    toggleButton.innerHTML = `<span class="icon">${icon(full ? 'collapse' : 'expand')}</span><span>${full ? '줄이기' : '전체지도'}</span>`;
    toggleButton.setAttribute('aria-pressed', String(full));
    toggleButton.setAttribute('aria-label', toggleLabel);
    toggleButton.title = toggleLabel;

    const returnsToDetail = full && focusModes.has(fullReturnMode);
    const listLabel = returnsToDetail ? '상세 보기' : full ? '검색·목록' : expandedList ? '지도 보기' : '목록 보기';
    listButton.innerHTML = `<span class="icon">${icon(returnsToDetail ? 'pin' : expandedList ? 'map' : 'list')}</span><span>${listLabel}</span>`;
    listButton.setAttribute('aria-expanded', String(expandedList));
    listButton.setAttribute('aria-label', listLabel);
    listButton.setAttribute('aria-controls', returnsToDetail ? 'detail-dialog' : 'station-sidebar');
    listButton.title = listLabel;

    if (detailExpandButton) {
      const expanded = mode === 'expanded-tools';
      const label = expanded ? '상세 줄이기' : '상세 크게';
      detailExpandButton.innerHTML = `<span class="icon">${icon(expanded ? 'collapse' : 'expand')}</span><span>${label}</span>`;
      detailExpandButton.setAttribute('aria-expanded', String(expanded));
      detailExpandButton.setAttribute('aria-label', expanded ? '상세 패널과 지도 도구 줄이기' : '상세 패널과 지도 도구 크게 보기');
      detailExpandButton.title = label;
    }
  }

  function applyBodyMode(next) {
    const active = mapModes.has(next);
    body.classList.toggle('mobile-map-mode', active);
    body.classList.toggle('mobile-map-focus', next === 'focus-detail');
    body.classList.toggle('mobile-map-expanded', next === 'expanded-tools');
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

  function restoreBase({ showList = false, restoreFocus = true } = {}) {
    cancelRestore();
    cancelLayout();
    const saved = previous;
    previous = null;
    requestResize();
    body.classList.remove('mobile-map-mode', 'mobile-map-focus', 'mobile-map-expanded', 'mobile-map-fullscreen');
    const expanded = Boolean(showList || saved?.expanded);
    workspace.classList.toggle('list-expanded', expanded);
    sidebar.inert = saved?.inert ?? false;
    mode = expanded ? 'list' : 'default';
    fullReturnMode = 'default';
    syncButtons();
    onModeChange(mode);
    if (!saved) return;
    const currentRevision = revision;
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = 0;
      if (destroyed || mapModes.has(mode) || currentRevision !== revision) return;
      window.scrollTo({ left: saved.pageLeft, top: saved.pageTop, behavior: 'instant' });
      sidebar.scrollTop = saved.sidebarTop;
      results.scrollTop = saved.listTop;
      results.scrollLeft = saved.listLeft;
      const target = showList ? listButton : saved.focus;
      if (restoreFocus && !document.querySelector('dialog[open]') && target?.isConnected && !target.closest('[inert]') && target.getClientRects().length) {
        target.focus({ preventScroll: true });
      }
    });
  }

  function enterDetail() {
    if (destroyed || !media.matches) return false;
    snapshot();
    showDetail();
    armHistory();
    fullReturnMode = 'focus-detail';
    setMode('focus-detail');
    return true;
  }

  function closeDetail({ showList = false, restoreFocus = true, fromHistory = false, skipHistory = false } = {}) {
    if (destroyed) return;
    if (!media.matches) {
      hideDetail();
      return;
    }
    if (!fromHistory && !skipHistory && historyArmed && historyObject()[historyKey]) {
      history.back();
      return;
    }
    if (skipHistory) disarmHistoryInPlace();
    else historyArmed = false;
    hideDetail();
    restoreBase({ showList, restoreFocus });
  }

  function toggleDetailExpanded() {
    if (destroyed || !media.matches || !detailDialog?.open) return;
    if (mode === 'expanded-tools') {
      setMode('focus-detail');
      fullReturnMode = 'focus-detail';
    } else {
      setMode('expanded-tools');
      fullReturnMode = 'expanded-tools';
    }
  }

  function toggleFullMap() {
    if (destroyed || !media.matches) return;
    if (mode === 'full-map') {
      if (focusModes.has(fullReturnMode) && detailDialog?.open) setMode(fullReturnMode);
      else restoreBase();
      return;
    }
    snapshot();
    fullReturnMode = focusModes.has(mode) ? mode : 'default';
    setMode('full-map');
    toggleButton.focus({ preventScroll: true });
  }

  function toggleList() {
    if (destroyed || !media.matches) return;
    if (mode === 'full-map') {
      if (focusModes.has(fullReturnMode) && detailDialog?.open) {
        setMode(fullReturnMode);
        return;
      }
      restoreBase({ showList: true });
      return;
    }
    if (focusModes.has(mode)) return;
    cancelRestore();
    requestResize();
    workspace.classList.toggle('list-expanded');
    mode = workspace.classList.contains('list-expanded') ? 'list' : 'default';
    syncButtons();
    onModeChange(mode);
  }

  function exit({ showList = false, restoreFocus = true, skipHistory = false } = {}) {
    if (destroyed) return;
    const hasDetail = focusModes.has(mode) || (mode === 'full-map' && focusModes.has(fullReturnMode));
    if (hasDetail) {
      closeDetail({ showList, restoreFocus, skipHistory });
      return;
    }
    if (mode === 'full-map') {
      restoreBase({ showList, restoreFocus });
      return;
    }
    if (showList && media.matches && !workspace.classList.contains('list-expanded')) {
      requestResize();
      workspace.classList.add('list-expanded');
      mode = 'list';
    }
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
    if (mode === 'expanded-tools') {
      event.preventDefault();
      setMode('focus-detail');
      fullReturnMode = 'focus-detail';
      return;
    }
    if (mode === 'full-map') {
      event.preventDefault();
      toggleFullMap();
      return;
    }
    if (mode === 'focus-detail') {
      event.preventDefault();
      closeDetail();
    }
  }

  function onPopState() {
    if (!historyArmed) return;
    historyArmed = false;
    if (focusModes.has(mode) || (mode === 'full-map' && focusModes.has(fullReturnMode))) {
      closeDetail({ fromHistory: true, restoreFocus: false });
    }
  }

  function onMediaChange() {
    if (!media.matches) {
      const hadDetail = focusModes.has(mode) || (mode === 'full-map' && focusModes.has(fullReturnMode));
      disarmHistoryInPlace();
      body.classList.remove('mobile-map-mode', 'mobile-map-focus', 'mobile-map-expanded', 'mobile-map-fullscreen');
      if (previous) workspace.classList.toggle('list-expanded', previous.expanded);
      sidebar.inert = previous?.inert ?? false;
      previous = null;
      mode = 'default';
      fullReturnMode = 'default';
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
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('popstate', onPopState);
  media.addEventListener('change', onMediaChange);
  syncButtons();

  return {
    enterDetail,
    closeDetail,
    toggleDetailExpanded,
    exit,
    afterLayout,
    isActive: () => mapModes.has(mode),
    isDetailOpen: () => focusModes.has(mode) || (mode === 'full-map' && focusModes.has(fullReturnMode)),
    isMobile: () => media.matches,
    getMode: () => mode,
    destroy() {
      if (destroyed) return;
      disarmHistoryInPlace();
      hideDetail();
      restoreBase({ restoreFocus: false });
      cancelRestore();
      cancelLayout();
      destroyed = true;
      toggleButton.removeEventListener('click', toggleFullMap);
      listButton.removeEventListener('click', toggleList);
      detailExpandButton?.removeEventListener('click', toggleDetailExpanded);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      media.removeEventListener('change', onMediaChange);
    },
  };
}
