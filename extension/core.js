(function (root) {
  'use strict';
  const MIN_RATE = 0.25, MAX_RATE = 4;
  const PRESETS = Object.freeze([0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
  const DEFAULTS = Object.freeze({ manualRate: 1, activePreset: 'A', presetRateA: 1, presetRateB: 2, favoriteRate: 1.5, step: 0.1, showOverlay: true, shortcuts: true, rememberRate: true });
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const rate = (value, fallback = 1) => typeof value === 'number' && Number.isFinite(value) ? round(clamp(value, MIN_RATE, MAX_RATE)) : fallback;
  const format = value => `${Number(value.toFixed(2))}×`;
  function normalizeDomain(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const input = value.trim().replace(/^\*\./, '');
      const url = new URL(input.includes('://') ? input : `https://${input}`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
      return /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\])$/.test(host) && !host.includes('..') ? host : '';
    } catch { return ''; }
  }
  function normalizeExclusions(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(normalizeDomain).filter(Boolean))].slice(0, 200);
  }
  function isExcluded(host, domains) {
    const normalized = normalizeDomain(host);
    return Boolean(normalized && domains.some(domain => normalized === domain || normalized.endsWith(`.${domain}`)));
  }
  function mediaScore({ playing = false, area = 0, visible = true, interacted = false, audio = false, muted = false } = {}) {
    return (interacted ? 1e9 : 0) + (playing ? 1e7 : 0) + (visible ? 1e6 : 0) + (audio ? 1000 : Math.min(Math.max(area, 0), 900000)) - (muted && area < 40000 ? 2e6 : 0);
  }
  function sanitize(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    return {
      manualRate: rate(value.manualRate), favoriteRate: rate(value.favoriteRate, DEFAULTS.favoriteRate),
      activePreset: value.activePreset === 'B' ? 'B' : 'A',
      presetRateA: rate(value.presetRateA, rate(value.manualRate)), presetRateB: rate(value.presetRateB, DEFAULTS.presetRateB),
      step: [0.05, 0.1, 0.25].includes(value.step) ? value.step : DEFAULTS.step,
      showOverlay: typeof value.showOverlay === 'boolean' ? value.showOverlay : true,
      shortcuts: typeof value.shortcuts === 'boolean' ? value.shortcuts : true,
      rememberRate: typeof value.rememberRate === 'boolean' ? value.rememberRate : true
    };
  }
  function actionRate(action, current, settings, activePreset = settings.activePreset, value) {
    let next = current, slot = activePreset === 'B' ? 'B' : 'A';
    if (action === 'increase') next = current + settings.step;
    else if (action === 'decrease') next = current - settings.step;
    else if (action === 'toggle') {
      slot = slot === 'A' ? 'B' : 'A';
      next = settings[`presetRate${slot}`];
    }
    else if (action === 'presetA' || action === 'presetB') { slot = action.slice(-1); next = settings[`presetRate${slot}`]; }
    else if (action === 'favorite') next = settings.favoriteRate;
    else if (action === 'set') next = value;
    next = rate(next, current);
    const patch = { manualRate: next, activePreset: slot };
    if (['increase', 'decrease', 'favorite', 'set'].includes(action)) patch[`presetRate${slot}`] = next;
    return { rate: next, activePreset: slot, patch };
  }
  function shortcutAction(event) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    if (path.some(node => node && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || ['textbox', 'searchbox', 'combobox', 'slider'].includes(node.getAttribute?.('role'))))) return null;
    return ({ BracketLeft: 'decrease', BracketRight: 'increase', Backslash: 'toggle' })[event.code] || null;
  }
  const api = { MIN_RATE, MAX_RATE, PRESETS, DEFAULTS, clamp, round, rate, format, sanitize, actionRate, shortcutAction, normalizeDomain, normalizeExclusions, isExcluded, mediaScore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaceFit = api;
})(globalThis);
