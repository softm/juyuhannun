export function setupMobileMapView({workspace, sidebar, mapSection, results, toggleButton, listButton, onResize = () => {}, icon}) {
  const media = window.matchMedia('(max-width:1000px)');
  const body = document.body;
  let active = false;
  let previous = null;
  let restoreFrame = 0;
  let revision = 0;
  let destroyed = false;

  function cancelRestore() {
    revision++;
    if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
  }

  function syncButtons() {
    const expanded = !active && workspace.classList.contains('list-expanded');
    const label = active ? '지도 전체 화면 닫기' : '지도 전체 화면';
    toggleButton.innerHTML = `<span class="icon">${icon(active ? 'collapse' : 'expand')}</span><span>${active ? '줄이기' : '전체지도'}</span>`;
    toggleButton.setAttribute('aria-pressed', String(active));
    toggleButton.setAttribute('aria-label', label);
    toggleButton.title = label;
    const listLabel = active ? '검색·목록' : expanded ? '지도 보기' : '목록 보기';
    listButton.innerHTML = `<span class="icon">${icon(expanded ? 'map' : 'list')}</span><span>${listLabel}</span>`;
    listButton.setAttribute('aria-expanded', String(expanded));
    listButton.setAttribute('aria-label', listLabel);
    listButton.setAttribute('aria-controls', 'station-sidebar');
    listButton.title = listLabel;
  }

  function enter() {
    if (destroyed || active || !media.matches) return;
    cancelRestore();
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
    // Capture the map center before its container changes size.
    onResize();
    active = true;
    workspace.classList.remove('list-expanded');
    body.classList.add('mobile-map-fullscreen');
    sidebar.inert = true;
    syncButtons();
    toggleButton.focus({preventScroll:true});
  }

  function exit({showList = false, restoreFocus = true} = {}) {
    if (destroyed) return;
    if (!active) {
      if (showList && media.matches && !workspace.classList.contains('list-expanded')) {
        cancelRestore();
        onResize();
        workspace.classList.add('list-expanded');
      }
      syncButtons();
      return;
    }
    cancelRestore();
    const saved = previous;
    previous = null;
    onResize();
    active = false;
    body.classList.remove('mobile-map-fullscreen');
    workspace.classList.toggle('list-expanded', showList || saved.expanded);
    sidebar.inert = saved.inert;
    syncButtons();
    const currentRevision = revision;
    // A later toggle must cancel this restoration before it can move the page.
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = 0;
      if (destroyed || active || currentRevision !== revision) return;
      window.scrollTo({left:saved.pageLeft, top:saved.pageTop, behavior:'instant'});
      sidebar.scrollTop = saved.sidebarTop;
      results.scrollTop = saved.listTop;
      results.scrollLeft = saved.listLeft;
      const target = showList ? listButton : saved.focus;
      if (restoreFocus && !document.querySelector('dialog[open]') && target?.isConnected && !target.closest('[inert]') && target.getClientRects().length) {
        target.focus({preventScroll:true});
      }
    });
  }

  function toggle() {
    if (active) exit();
    else enter();
  }

  function toggleList() {
    if (destroyed || !media.matches) return;
    if (active) { exit({showList:true}); return; }
    cancelRestore();
    onResize();
    workspace.classList.toggle('list-expanded');
    syncButtons();
  }

  function onKeyDown(event) {
    if (!active || event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    exit();
  }

  function onMediaChange() {
    if (!media.matches) exit({restoreFocus:false});
    else syncButtons();
  }

  if (mapSection.id) toggleButton.setAttribute('aria-controls', mapSection.id);
  toggleButton.addEventListener('click', toggle);
  listButton.addEventListener('click', toggleList);
  document.addEventListener('keydown', onKeyDown);
  media.addEventListener('change', onMediaChange);
  syncButtons();

  return {
    exit,
    isActive: () => active,
    destroy() {
      if (destroyed) return;
      exit({restoreFocus:false});
      cancelRestore();
      destroyed = true;
      toggleButton.removeEventListener('click', toggle);
      listButton.removeEventListener('click', toggleList);
      document.removeEventListener('keydown', onKeyDown);
      media.removeEventListener('change', onMediaChange);
    },
  };
}
