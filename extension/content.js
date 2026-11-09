(() => {
  'use strict';
  const C = globalThis.PaceFit, records = new Map(), observedRoots = new WeakSet();
  let settings = C.sanitize(), exclusions = [], topHost = '', enabled = true, initialized = false;
  let selected = null, host = null, shadow = null, panelOpen = false, feedbackTimer = null;
  let storageError = false, controlError = '', pointer = null, positionFrame = null;
  const frameHost = C.normalizeDomain(location.hostname);
  const youtube = frameHost === 'youtube.com' || frameHost.endsWith('.youtube.com');
  const isAd = () => Boolean(youtube && selected?.media.closest('#movie_player')?.matches('.ad-showing,.ad-interrupting'));
  const currentRate = () => selected ? isAd() ? selected.desiredRate : C.rate(selected.media.playbackRate) : settings.manualRate;
  const currentLabel = () => `${selected?.activePreset || settings.activePreset} · ${C.format(currentRate())}`;
  const sourceKey = media => `${location.pathname}${location.search}|${media.currentSrc || media.src || ''}`;
  const rectVisible = rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  const containsPoint = (rect, point) => point && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  function score(record) {
    const media = record.media, rect = media.getBoundingClientRect();
    const playing = !media.paused && !media.ended, visible = rectVisible(rect) && getComputedStyle(media).visibility !== 'hidden';
    return C.mediaScore({ playing, area: rect.width * rect.height, visible,
      interacted: (visible || playing) && Date.now() - record.interacted < 30000 || Boolean(visible && pointer && containsPoint(rect, pointer)), audio: media.tagName === 'AUDIO', muted: media.muted });
  }
  function setPlayback(record, value) {
    if (!enabled || !record || isAd()) return;
    const rate = C.rate(value), media = record.media;
    if (Math.abs(media.playbackRate - rate) < 0.005) return;
    try {
      record.expected = rate; record.lastApplied = rate;
      media.preservesPitch = true; media.playbackRate = rate; controlError = '';
    } catch { record.expected = null; record.lastApplied = null; controlError = '이 플레이어에서 해당 배속을 적용하지 못했어요.'; }
  }
  // Each media owns its current target. Storage only holds explicit PaceFit choices.
  function beginSource(record) {
    record.appliedKey = sourceKey(record.media);
    record.desiredRate = settings.rememberRate ? settings.manualRate : 1;
    record.activePreset = settings.activePreset;
    record.stabilizeUntil = Date.now() + 6000;
    record.restoreAttempts = 0; record.lastRestore = 0;
    record.nativeUntil = 0; record.expected = null;
    record.initialFeedbackPending = true;
  }
  const initializingReset = record => Date.now() < record.stabilizeUntil && record.media.playbackRate === 1 && record.desiredRate !== 1 && Date.now() >= record.nativeUntil;
  function ensurePreferred(record) {
    if (!record || !enabled || isAd()) return;
    if (record.appliedKey !== sourceKey(record.media)) {
      if (record.appliedKey !== null) record.originalRate = record.media.playbackRate === record.lastApplied ? 1 : record.media.playbackRate;
      beginSource(record);
      setPlayback(record, record.desiredRate);
    } else if (initializingReset(record) && record.restoreAttempts < 20 && Date.now() - record.lastRestore >= 100) {
      record.restoreAttempts++; record.lastRestore = Date.now();
      setPlayback(record, record.desiredRate);
    }
  }
  function select(record) {
    if (!record || selected === record) { if (record) ensurePreferred(record); return; }
    clearFeedback(); panelOpen = false; selected = record;
    ensurePreferred(record); mountOverlay(); renderOverlay();
  }
  function chooseMedia() {
    for (const [media, record] of records) if (!media.isConnected) {
      for (const [event, handler] of Object.entries(record.handlers)) media.removeEventListener(event, handler);
      records.delete(media); if (selected === record) selected = null;
    }
    const candidates = [...records.values()].sort((a, b) => score(b) - score(a));
    select(candidates[0]);
  }
  async function persist(patch) {
    try {
      const result = await chrome.runtime.sendMessage({ source: 'pacefit-content', type: 'saveRate', patch });
      if (!result?.ok) throw new Error('Storage failed');
      storageError = false;
    } catch { storageError = true; }
  }
  function act(action, value) {
    if (!enabled || !selected) return Promise.resolve();
    selected.interacted = Date.now();
    const next = C.actionRate(action, currentRate(), settings, selected.activePreset, value);
    selected.activePreset = next.activePreset;
    selected.desiredRate = next.rate; selected.nativeUntil = 0;
    settings = C.sanitize({ ...settings, ...next.patch });
    setPlayback(selected, next.rate); renderOverlay();
    if (shadow) shadow.getElementById('announcement').textContent = `프리셋 ${selected.activePreset}, 재생 속도 ${C.format(next.rate)}`;
    return persist(next.patch);
  }
  function register(media) {
    if (records.has(media)) return;
    const record = { media, originalRate: media.playbackRate, lastApplied: null, expected: null, appliedKey: null,
      desiredRate: 1, stabilizeUntil: 0, nativeUntil: 0, activePreset: settings.activePreset, interacted: 0, adWasPlaying: false, handlers: {} };
    record.handlers.play = () => { select(record); ensurePreferred(record); };
    for (const event of ['loadstart', 'emptied']) record.handlers[event] = () => {
      record.appliedKey = null; record.expected = null;
      if (selected === record) { clearFeedback(); ensurePreferred(record); }
    };
    for (const event of ['loadedmetadata', 'canplay', 'playing']) record.handlers[event] = () => {
      if (event !== 'canplay') { record.stabilizeUntil = Date.now() + 6000; record.restoreAttempts = 0; }
      if (selected === record) { ensurePreferred(record); renderOverlay(); }
    };
    record.handlers.ratechange = () => {
      if (!enabled || record !== selected || isAd() || record.adWasPlaying) return;
      ensurePreferred(record);
      const actual = C.rate(media.playbackRate);
      if (record.expected !== null && Math.abs(actual - record.expected) < 0.005) { record.expected = null; renderOverlay(); return; }
      record.expected = null;
      if (initializingReset(record)) return;
      if (Math.abs(actual - record.desiredRate) < 0.005) { renderOverlay(); return; }
      // Unknown/native changes affect this video only; never save player resets.
      record.originalRate = actual; record.lastApplied = null; record.desiredRate = actual;
      renderOverlay(); flashFeedback();
    };
    records.set(media, record);
    for (const [event, handler] of Object.entries(record.handlers)) media.addEventListener(event, handler);
  }
  function scan(root) {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.id === 'pacefit-controller') return;
    if (root.shadowRoot) observe(root.shadowRoot);
    if (root.matches?.('video,audio')) register(root);
    root.querySelectorAll('video,audio').forEach(register);
    for (const node of root.querySelectorAll('*')) if (node.id !== 'pacefit-controller' && node.shadowRoot) observe(node.shadowRoot);
  }
  function observe(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root); scan(root);
    new MutationObserver(mutations => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) scan(node);
    }).observe(root, { childList: true, subtree: true });
  }
  function updateEnabled() {
    const next = !C.isExcluded(topHost, exclusions) && !C.isExcluded(frameHost, exclusions);
    if (enabled && !next) {
      // Undo only a rate still owned by PaceFit; preserve native/user changes.
      for (const record of records.values()) {
        if (record.lastApplied !== null && Math.abs(record.media.playbackRate - record.lastApplied) < 0.005) {
          try { record.media.playbackRate = record.originalRate; } catch { /* A detached/custom player may reject rates. */ }
        }
        record.lastApplied = null; record.expected = null; record.appliedKey = null;
      }
      panelOpen = false; clearFeedback();
    }
    enabled = next;
    if (enabled) ensurePreferred(selected);
    renderOverlay();
  }
  function tick() {
    if (!initialized) return;
    chooseMedia();
    if (selected && isAd()) { selected.adWasPlaying = true; clearFeedback(); }
    else if (selected?.adWasPlaying) { selected.adWasPlaying = false; setPlayback(selected, selected.desiredRate); }
    mountOverlay(); renderOverlay();
  }
  function snapshot() {
    return { connected: Boolean(enabled && selected), mediaFound: Boolean(selected), enabled, frameHost,
      mediaType: selected?.media.tagName.toLowerCase(), score: selected ? score(selected) : 0,
      title: document.title, settings: { ...settings }, rate: currentRate(), activePreset: selected?.activePreset || settings.activePreset,
      ad: isAd(), storageError, controlError };
  }
  function anchorRect() {
    const media = selected?.media;
    if (!media) return null;
    return (youtube ? media.closest('#movie_player') || media : media).getBoundingClientRect();
  }
  function positionOverlay() {
    positionFrame = null;
    if (!host || !selected) return;
    const rect = anchorRect(), visible = rect && rectVisible(rect);
    const audio = selected.media.tagName === 'AUDIO';
    const left = visible ? C.clamp(rect.left + 14, 8, Math.max(8, innerWidth - (panelOpen ? 268 : 170))) : 14;
    const top = visible ? C.clamp(audio ? rect.top - 44 : rect.top + 14, 8, Math.max(8, innerHeight - 44)) : 14;
    host.style.setProperty('--pacefit-left', `${left}px`); host.style.setProperty('--pacefit-top', `${top}px`);
    const hovered = Boolean(visible && (containsPoint(rect, pointer) || (host.hasAttribute('data-hovered') || panelOpen) && containsPoint(host.getBoundingClientRect(), pointer)));
    host.toggleAttribute('data-hovered', hovered);
    if (!hovered && !shadow.activeElement?.matches(':focus-visible')) {
      panelOpen = false; shadow.getElementById('panel').hidden = true;
      shadow.getElementById('speed').setAttribute('aria-expanded', 'false'); shadow.querySelector('.bar').classList.remove('open');
    }
  }
  function schedulePosition() { if (positionFrame === null) positionFrame = requestAnimationFrame(positionOverlay); }
  function mountOverlay() {
    if (!selected || !enabled) { host?.remove(); host = null; shadow = null; return; }
    const fullscreen = document.fullscreenElement;
    const parent = fullscreen && !fullscreen.matches('video,audio') ? fullscreen : document.documentElement;
    if (host) { if (host.parentElement !== parent) parent.append(host); return; }
    ({ host, shadow } = C.createOverlay());
    for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup']) host.addEventListener(type, event => event.stopPropagation());
    shadow.getElementById('slower').addEventListener('click', () => act('decrease'));
    shadow.getElementById('faster').addEventListener('click', () => act('increase'));
    shadow.getElementById('speed').addEventListener('click', () => { panelOpen = !panelOpen; renderOverlay(); });
    shadow.getElementById('close').addEventListener('click', closePanel);
    shadow.querySelectorAll('[data-rate]').forEach(button => button.addEventListener('click', () => act('set', Number(button.dataset.rate))));
    shadow.getElementById('slider').addEventListener('input', event => act('set', Number(event.target.value)));
    shadow.getElementById('toggle').addEventListener('click', () => act('toggle'));
    for (const slot of ['A', 'B']) shadow.getElementById(`preset-${slot.toLowerCase()}`).addEventListener('click', () => act(`preset${slot}`));
    shadow.getElementById('favorite').addEventListener('click', () => act('favorite'));
    parent.append(host); positionOverlay();
  }
  function clearFeedback() { clearTimeout(feedbackTimer); feedbackTimer = null; host?.removeAttribute('data-feedback'); }
  function flashFeedback() {
    if (!enabled || !selected || isAd()) return;
    mountOverlay(); clearFeedback(); shadow.getElementById('feedback').textContent = currentLabel();
    host.setAttribute('data-feedback', '');
    const target = host; feedbackTimer = setTimeout(() => { target.removeAttribute('data-feedback'); feedbackTimer = null; }, 1500);
  }
  function closePanel() { panelOpen = false; renderOverlay(); shadow?.getElementById('speed').focus(); }
  function renderOverlay() {
    if (!host || !shadow || !selected) return;
    host.hidden = !enabled || isAd() || document.fullscreenElement === selected.media;
    shadow.querySelector('.controls').hidden = !settings.showOverlay;
    host.toggleAttribute('data-controls-enabled', settings.showOverlay);
    const rate = currentRate();
    if (host.hasAttribute('data-feedback')) shadow.getElementById('feedback').textContent = currentLabel();
    shadow.getElementById('speed').textContent = currentLabel();
    shadow.getElementById('speed').setAttribute('aria-label', `현재 프리셋 ${selected.activePreset}, ${C.format(rate)}, 배속 메뉴 ${panelOpen ? '닫기' : '열기'}`);
    shadow.getElementById('speed').setAttribute('aria-expanded', String(panelOpen));
    shadow.querySelector('.bar').classList.toggle('open', panelOpen); shadow.getElementById('panel').hidden = !panelOpen;
    shadow.getElementById('slower').disabled = rate <= C.MIN_RATE; shadow.getElementById('faster').disabled = rate >= C.MAX_RATE;
    shadow.getElementById('slower').title = `${C.format(settings.step)} 낮추기${settings.shortcuts ? ' [ ' : ''}`;
    shadow.getElementById('faster').title = `${C.format(settings.step)} 높이기${settings.shortcuts ? ' ] ' : ''}`;
    shadow.getElementById('slider').value = rate; shadow.getElementById('slider').setAttribute('aria-valuetext', `${rate}배속`);
    shadow.getElementById('toggle').textContent = `A ${C.format(settings.presetRateA)} ↔ B ${C.format(settings.presetRateB)}`;
    for (const slot of ['A', 'B']) {
      const button = shadow.getElementById(`preset-${slot.toLowerCase()}`);
      button.textContent = `${slot} · ${C.format(settings[`presetRate${slot}`])}`;
      button.setAttribute('aria-pressed', String(selected.activePreset === slot));
    }
    shadow.getElementById('favorite').textContent = `★ ${C.format(settings.favoriteRate)}`; shadow.getElementById('help').hidden = !settings.shortcuts;
    shadow.querySelectorAll('[data-rate]').forEach(button => button.setAttribute('aria-pressed', String(Math.abs(Number(button.dataset.rate) - rate) < 0.005)));
    positionOverlay();
    if (selected.initialFeedbackPending && !host.hidden && selected.media.readyState >= 1 && rectVisible(anchorRect())) {
      selected.initialFeedbackPending = false;
      flashFeedback();
    }
  }
  function nativeRateGesture(event) {
    if (!selected || event.composedPath().includes(host)) return;
    const control = event.composedPath().find(node => node.matches?.('button,select,option,[role="menuitemradio"],[role="menuitem"],[role="option"]'));
    const label = control ? `${control.getAttribute('aria-label') || ''} ${control.textContent || ''} ${control.value || ''}`.trim() : '';
    if ((event.type === 'keydown' && ['<', '>'].includes(event.key)) || event.type === 'contextmenu' && event.target === selected.media || /(?:speed|재생\s*속도|배속|\d+(?:\.\d+)?\s*[×x배])/i.test(label)) {
      selected.nativeUntil = Date.now() + 1500;
    }
  }
  for (const event of ['click', 'change', 'keydown', 'contextmenu']) document.addEventListener(event, nativeRateGesture, true);
  document.addEventListener('pointermove', event => {
    pointer = { x: event.clientX, y: event.clientY };
    if (!initialized || !enabled) return;
    if (!event.composedPath().includes(host)) {
      const pointed = [...records.values()].filter(record => containsPoint(record.media.getBoundingClientRect(), pointer)).sort((a, b) => score(b) - score(a))[0];
      if (pointed) select(pointed);
    }
    schedulePosition();
  }, { passive: true, capture: true });
  document.addEventListener('pointerdown', event => {
    if (event.composedPath().includes(host)) return;
    if (selected && containsPoint(anchorRect(), { x: event.clientX, y: event.clientY })) selected.interacted = Date.now();
    if (panelOpen) { panelOpen = false; renderOverlay(); }
  }, true);
  document.addEventListener('pointerleave', () => { pointer = null; schedulePosition(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panelOpen && event.composedPath().includes(host)) { event.preventDefault(); event.stopPropagation(); closePanel(); return; }
    if (!initialized || !enabled || !settings.shortcuts || isAd() || document.querySelector('tp-yt-paper-dialog[opened]')) return;
    const action = C.shortcutAction(event);
    if (!action || (action === 'toggle' && event.repeat)) return;
    if ((!selected || selected.media.paused) && document.querySelector('iframe')) {
      chrome.runtime.sendMessage({ source: 'pacefit-content', type: 'shortcut', action }).catch(() => {});
      if (selected) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (!selected) return;
    event.preventDefault(); event.stopPropagation(); act(action); flashFeedback();
  }, true);
  for (const event of ['scroll', 'resize']) window.addEventListener(event, schedulePosition, { passive: true, capture: true });
  document.addEventListener('fullscreenchange', () => { mountOverlay(); renderOverlay(); });
  document.addEventListener('yt-navigate-start', () => {
    for (const record of records.values()) record.appliedKey = null;
    clearFeedback();
  });
  document.addEventListener('yt-navigate-finish', tick);
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.source !== 'pacefit-background') return;
    const run = async () => {
      await ready; tick();
      if (message.type === 'probe') {
        await chrome.runtime.sendMessage({ source: 'pacefit-content', type: 'report', token: message.token, state: snapshot() });
        return snapshot();
      }
      if (message.type === 'command') {
        if (!enabled) throw new Error('예외로 설정된 사이트예요.');
        if (!selected) throw new Error('재생할 영상이나 오디오를 찾지 못했어요.');
        if (!['set', 'increase', 'decrease', 'toggle', 'favorite', 'presetA', 'presetB'].includes(message.action)) throw new Error('알 수 없는 배속 조작입니다.');
        await act(message.action, message.value); if (message.feedback) flashFeedback(); return snapshot();
      }
      throw new Error('알 수 없는 요청입니다.');
    };
    run().then(state => respond({ ok: true, state })).catch(error => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.pacefitSettings) settings = C.sanitize(changes.pacefitSettings.newValue);
    if (changes.pacefitExcludedDomains) { exclusions = C.normalizeExclusions(changes.pacefitExcludedDomains.newValue); updateEnabled(); }
    renderOverlay();
  });
  const ready = Promise.all([
    chrome.storage.local.get(['pacefitSettings', 'pacefitExcludedDomains']),
    chrome.runtime.sendMessage({ source: 'pacefit-content', type: 'context' }).catch(() => ({}))
  ]).then(([saved, context]) => {
    settings = C.sanitize(saved.pacefitSettings); exclusions = C.normalizeExclusions(saved.pacefitExcludedDomains);
    topHost = context.siteHost || frameHost; updateEnabled(); initialized = true;
    observe(document); tick(); setInterval(tick, 500);
  });
})();
