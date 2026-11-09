(() => {
  'use strict';
  const C = globalThis.PaceFit, $ = id => document.getElementById(id);
  const demo = !globalThis.chrome?.runtime?.id;
  let state = { settings: C.sanitize(), rate: 1, activePreset: 'A', connected: false, supported: false, siteEnabled: false, exclusions: [] };
  let tabId = null, pending = 0, sequence = 0, queue = Promise.resolve(), toastTimer, renderedExclusions = '';
  const ready = initialize();
  function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600); }
  async function initialize() {
    if (demo) { $('demo-banner').hidden = false; Object.assign(state, { connected: true, supported: true, siteEnabled: true, enabled: true, siteHost: 'example.com', title: 'PaceFit 화면 데모' }); }
    else {
      try {
        const [saved, tabs] = await Promise.all([chrome.storage.local.get(['pacefitSettings', 'pacefitExcludedDomains']), chrome.tabs.query({ active: true, currentWindow: true })]);
        state.settings = C.sanitize(saved.pacefitSettings); state.rate = state.settings.manualRate;
        state.exclusions = C.normalizeExclusions(saved.pacefitExcludedDomains);
        state.activePreset = state.settings.activePreset;
        tabId = tabs[0]?.id; if (tabId) await refresh();
      } catch { /* Browser-internal/store pages do not allow content scripts. */ }
    }
    render();
  }
  async function message(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ source: 'pacefit-popup', tabId, frameId: state.frameId, type, ...extra });
    if (!response?.ok) throw new Error(response?.error || '영상에 연결하지 못했어요. 탭을 새로고침해 주세요.');
    return response.state;
  }
  async function refresh() {
    if (demo || pending || !tabId) return;
    const version = sequence;
    try { const next = await message('get'); if (!pending && version === sequence) state = next; }
    catch { if (!pending && version === sequence) state.connected = false; }
    render();
  }
  function transact(work) {
    const version = ++sequence; pending++;
    queue = queue.then(() => ready).then(async () => { const result = await work(); if (result && version === sequence) state = result; })
      .catch(error => toast(error.message)).finally(() => { pending--; render(); });
  }
  function canControl() { return state.supported && state.siteEnabled && state.enabled !== false; }
  function setRate(value, action = 'set') {
    if (!canControl()) return;
    const next = C.actionRate(action, state.rate, state.settings, state.activePreset, value);
    state.rate = next.rate; state.activePreset = next.activePreset;
    state.settings = C.sanitize({ ...state.settings, ...next.patch });
    render();
    transact(async () => {
      if (demo) return null;
      if (tabId && state.connected) return message('command', { action, value });
      await message('saveRate', { patch: next.patch });
      return null;
    });
  }
  function action(name) { setRate(undefined, name); }
  function update(patch, notice) {
    state.settings = C.sanitize({ ...state.settings, ...patch }); render();
    transact(async () => { const result = demo ? null : await message('update', { patch }); if (notice) toast(notice); return result ? { ...state, settings: result.settings } : null; });
  }
  function changeExclusion(domain, add) {
    const normalized = C.normalizeDomain(domain);
    if (!normalized) { toast('올바른 도메인이나 http/https 주소를 입력해 주세요.'); return; }
    const modify = list => add ? C.normalizeExclusions([...list, normalized]) : list.filter(item => item !== normalized);
    state.exclusions = modify(state.exclusions); state.siteEnabled = !C.isExcluded(state.siteHost, state.exclusions);
    state.enabled = state.siteEnabled && !C.isExcluded(state.frameHost, state.exclusions); render();
    transact(async () => {
      if (demo) return null;
      const saved = await chrome.storage.local.get('pacefitExcludedDomains');
      await chrome.storage.local.set({ pacefitExcludedDomains: modify(C.normalizeExclusions(saved.pacefitExcludedDomains)) });
      return message('get');
    });
  }
  function renderExclusions() {
    $('exception-count').textContent = `${state.exclusions.length}개`;
    const serialized = JSON.stringify(state.exclusions);
    if (renderedExclusions === serialized) return;
    renderedExclusions = serialized; $('exception-list').replaceChildren();
    for (const domain of state.exclusions) {
      const item = document.createElement('li'), label = document.createElement('span'), remove = document.createElement('button');
      label.textContent = domain; remove.textContent = '해제'; remove.type = 'button'; remove.setAttribute('aria-label', `${domain} 예외 해제`);
      remove.addEventListener('click', () => changeExclusion(domain, false)); item.append(label, remove); $('exception-list').append(item);
    }
  }
  function render() {
    const s = state.settings, rate = state.rate, usable = canControl();
    $('rate-label').textContent = `재생 속도 · ${state.activePreset}`;
    if (document.activeElement !== $('rate-input')) $('rate-input').value = rate.toFixed(2);
    if (document.activeElement !== $('rate-slider')) $('rate-slider').value = rate;
    $('rate-slider').setAttribute('aria-valuetext', `${rate}배속`);
    $('rate-input').disabled = !usable; $('rate-slider').disabled = !usable;
    $('rate-down').disabled = !usable || rate <= C.MIN_RATE; $('rate-up').disabled = !usable || rate >= C.MAX_RATE;
    $('step-label').textContent = `${C.format(s.step)}씩 조절`;
    $('rate-down').title = `${C.format(s.step)} 낮추기`; $('rate-up').title = `${C.format(s.step)} 높이기`;
    document.querySelectorAll('[data-rate]').forEach(button => { button.disabled = !usable; button.setAttribute('aria-pressed', String(Math.abs(Number(button.dataset.rate) - rate) < 0.005)); });
    const toggleLabel = `A ${C.format(s.presetRateA)} ↔ B ${C.format(s.presetRateB)} 전환`;
    $('toggle-rate').setAttribute('aria-label', toggleLabel); $('toggle-rate').title = toggleLabel;
    for (const slot of ['A', 'B']) {
      const button = $(`preset-${slot.toLowerCase()}`);
      button.textContent = `${slot} · ${C.format(s[`presetRate${slot}`])}`;
      button.setAttribute('aria-pressed', String(state.activePreset === slot));
      button.disabled = !usable;
    }
    $('toggle-rate').disabled = !usable; $('favorite').disabled = !usable;
    $('favorite').textContent = `★ 자주 쓰는 ${C.format(s.favoriteRate)}`;
    $('save-favorite').disabled = !usable || Math.abs(rate - s.favoriteRate) < 0.005;
    $('site-host').textContent = state.siteHost || '일반 웹사이트에서 사용할 수 있어요';
    $('site-enabled').disabled = !state.siteHost; $('site-enabled').checked = state.siteEnabled;
    $('connection').textContent = demo ? 'DEMO' : !usable && state.supported ? '예외 적용' : state.connected ? state.ad ? '광고 중' : '연결됨' : '영상 연결 필요';
    $('connection').classList.toggle('ready', state.connected && usable);
    $('status').textContent = state.storageError ? '배속은 적용했지만 설정을 저장하지 못했어요.' : state.controlError ? state.controlError : !state.supported ? '브라우저 내부 페이지·Chrome 웹 스토어에서는 작동하지 않아요. 일반 웹사이트를 열어주세요.' : !state.siteEnabled ? '이 사이트는 예외로 설정되어 있어요. 버튼·단축키·배속 유지가 모두 꺼져요.' : state.enabled === false ? `임베드 사이트 ${state.frameHost}가 예외 목록에 있어요. 목록에서 해제할 수 있어요.` : !state.connected ? '영상이나 오디오를 재생해 주세요. 설치·업데이트 후에는 탭을 새로고침해 주세요.' : state.ad ? `광고가 끝나면 ${C.format(rate)}로 재생해요.` : state.mediaType === 'audio' ? 'HTML5 오디오를 조절하고 있어요. 단축키로도 바꿀 수 있어요.' : s.showOverlay ? '영상에 마우스를 올리면 왼쪽 위에 조절 버튼이 나타나요.' : '단축키로 바꾸면 현재 배속이 1.5초 동안 표시돼요.';
    $('status').title = state.title || '';
    $('remembered-rate').textContent = s.rememberRate ? `다음 영상 시작 속도: ${C.format(s.manualRate)}` : '새 영상은 1×로 시작해요. 저장한 배속은 유지돼요.';
    $('keyboard-guide').hidden = !s.shortcuts; $('toggle-rate').querySelector('kbd').hidden = !s.shortcuts;
    if (document.activeElement !== $('step')) $('step').value = s.step;
    $('show-overlay').checked = s.showOverlay; $('shortcuts').checked = s.shortcuts; $('remember-rate').checked = s.rememberRate;
    renderExclusions();
  }
  $('site-enabled').addEventListener('change', event => {
    if (event.target.checked) {
      const parent = state.exclusions.find(domain => domain !== state.siteHost && C.isExcluded(state.siteHost, [domain]));
      if (parent) { toast(`예외 목록에서 상위 도메인 ${parent}를 먼저 해제해 주세요.`); render(); return; }
      changeExclusion(state.siteHost, false);
    } else changeExclusion(state.siteHost, true);
  });
  $('exception-form').addEventListener('submit', event => {
    event.preventDefault(); const domain = C.normalizeDomain($('excluded-domain').value);
    if (!domain) { toast('올바른 도메인이나 http/https 주소를 입력해 주세요.'); return; }
    changeExclusion(domain, true); $('excluded-domain').value = '';
  });
  $('rate-down').addEventListener('click', () => action('decrease')); $('rate-up').addEventListener('click', () => action('increase'));
  document.querySelectorAll('[data-rate]').forEach(button => button.addEventListener('click', () => setRate(Number(button.dataset.rate))));
  $('rate-input').addEventListener('change', event => {
    if (Number.isFinite(event.target.valueAsNumber)) { const value = C.rate(event.target.valueAsNumber); event.target.value = value.toFixed(2); setRate(value); }
    else { event.target.value = state.rate.toFixed(2); toast('0.25~4 사이의 배속을 입력해 주세요.'); }
  });
  $('rate-input').addEventListener('blur', render); $('rate-slider').addEventListener('input', event => setRate(Number(event.target.value)));
  for (const slot of ['A', 'B']) $(`preset-${slot.toLowerCase()}`).addEventListener('click', () => action(`preset${slot}`));
  $('toggle-rate').addEventListener('click', () => action('toggle')); $('favorite').addEventListener('click', () => action('favorite'));
  $('save-favorite').addEventListener('click', () => update({ favoriteRate: state.rate }, `${C.format(state.rate)}를 자주 쓰는 속도로 저장했어요.`));
  $('step').addEventListener('change', event => update({ step: Number(event.target.value) }));
  for (const [id, key] of [['show-overlay', 'showOverlay'], ['shortcuts', 'shortcuts'], ['remember-rate', 'rememberRate']]) $(id).addEventListener('change', event => update({ [key]: event.target.checked }));
  setInterval(refresh, 1200);
})();
