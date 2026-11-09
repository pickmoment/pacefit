const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');

test('migration preserves manual speed but discards all automatic-analysis settings', () => {
  const s = C.sanitize({ mode: 'auto', manualRate: 1.75, targetPace: 300, language: 'ko' });
  assert.deepEqual(s, { manualRate: 1.75, activePreset: 'A', presetRateA: 1.75, presetRateB: 2, favoriteRate: 1.5, step: 0.1, showOverlay: true, shortcuts: true, rememberRate: true });
});
test('invalid stored data and nonfinite rates cannot break controls', () => {
  assert.deepEqual(C.sanitize(null), C.DEFAULTS);
  assert.equal(C.rate(Infinity), 1);
  assert.equal(C.rate(-2), 0.25);
  assert.equal(C.rate(9), 4);
  assert.equal(C.sanitize({ step: 0.01, shortcuts: 'false' }).shortcuts, true);
});
test('rapid incremental changes do not accumulate floating-point drift', () => {
  let current = 1;
  for (let i = 0; i < 20; i++) current = C.actionRate('increase', current, C.sanitize()).rate;
  assert.equal(current, 3);
  for (let i = 0; i < 20; i++) current = C.actionRate('decrease', current, C.sanitize()).rate;
  assert.equal(current, 1);
});
test('all step sizes and speed limits are respected', () => {
  for (const step of [0.05, 0.1, 0.25]) assert.equal(C.actionRate('increase', 1, C.sanitize({ step })).rate, 1 + step);
  assert.equal(C.actionRate('decrease', 0.25, C.sanitize()).rate, 0.25);
  assert.equal(C.actionRate('increase', 4, C.sanitize()).rate, 4);
});
test('A/B adjustments update only the selected preset and toggles recall their stored values', () => {
  let settings = C.sanitize();
  let next = C.actionRate('set', 1, settings, 'A', 1.5);
  settings = C.sanitize({ ...settings, ...next.patch });
  assert.equal(settings.presetRateA, 1.5); assert.equal(settings.presetRateB, 2);
  next = C.actionRate('toggle', 1.5, settings);
  assert.equal(next.rate, 2); assert.equal(next.activePreset, 'B');
  settings = C.sanitize({ ...settings, ...next.patch });
  next = C.actionRate('set', 2, settings, 'B', 2.3);
  settings = C.sanitize({ ...settings, ...next.patch });
  assert.equal(settings.presetRateA, 1.5); assert.equal(settings.presetRateB, 2.3);
  for (let i = 0; i < 4; i++) {
    next = C.actionRate('toggle', settings.manualRate, settings);
    settings = C.sanitize({ ...settings, ...next.patch });
    assert.equal(next.rate, i % 2 === 0 ? 1.5 : 2.3);
    assert.equal(settings.presetRateA, 1.5); assert.equal(settings.presetRateB, 2.3);
  }
});
test('explicit slot selection, equal presets, and keyboard increments preserve slot identity', () => {
  const settings = C.sanitize({ presetRateA: 1.25, presetRateB: 1.25, favoriteRate: 1.75 });
  assert.equal(C.actionRate('presetB', 3, settings).activePreset, 'B');
  assert.equal(C.actionRate('toggle', 1.25, settings).activePreset, 'B');
  assert.deepEqual(C.actionRate('increase', 1.25, settings, 'B').patch, { manualRate: 1.35, activePreset: 'B', presetRateB: 1.35 });
  assert.equal(C.actionRate('favorite', 2, settings, 'A').patch.presetRateA, 1.75);
  assert.equal(C.sanitize({ manualRate: 1.75, previousRate: 3 }).previousRate, undefined);
});
test('physical shortcut keys work regardless of keyboard-language characters', () => {
  assert.equal(C.shortcutAction({ code: 'BracketLeft', key: '「' }), 'decrease');
  assert.equal(C.shortcutAction({ code: 'BracketRight' }), 'increase');
  assert.equal(C.shortcutAction({ code: 'Backslash', key: '₩' }), 'toggle');
  assert.equal(C.shortcutAction({ code: 'KeyS' }), null);
});
test('typing, nested editable elements, ARIA editors, IME and modifiers are excluded', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(C.shortcutAction({ code: 'BracketRight', target: { tagName } }), null);
  assert.equal(C.shortcutAction({ code: 'BracketRight', composedPath: () => [{ tagName: 'SPAN' }, { isContentEditable: true }] }), null);
  assert.equal(C.shortcutAction({ code: 'BracketRight', target: { getAttribute: () => 'textbox' } }), null);
  for (const key of ['defaultPrevented', 'ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'isComposing']) assert.equal(C.shortcutAction({ code: 'BracketRight', [key]: true }), null);
});
test('domain rules accept URLs, ports, IDNs, and a leading wildcard safely', () => {
  assert.equal(C.normalizeDomain('https://WWW.Example.COM:8443/watch?v=1'), 'example.com');
  assert.equal(C.normalizeDomain('*.example.com'), 'example.com');
  assert.equal(C.normalizeDomain('localhost:4173'), 'localhost');
  assert.equal(C.normalizeDomain('https://한글.com'), new URL('https://한글.com').hostname);
  for (const value of ['chrome://extensions', 'file:///tmp/video.mp4', 'https://user:pass@example.com', 'hello world', 'javascript:alert(1)', null]) assert.equal(C.normalizeDomain(value), '');
});
test('exclusions match subdomains but never similarly named domains', () => {
  const rules = C.normalizeExclusions(['example.com', 'www.example.com', '*.example.com', '', 'localhost']);
  assert.deepEqual(rules, ['example.com', 'localhost']);
  assert.equal(C.isExcluded('video.news.example.com', rules), true);
  assert.equal(C.isExcluded('badexample.com', rules), false);
  assert.equal(C.isExcluded('example.com.evil.test', rules), false);
  assert.equal(C.isExcluded('http://localhost:4173', rules), true);
});
test('media choice favors interaction, playback, and large visible content', () => {
  assert.ok(C.mediaScore({ interacted: true }) > C.mediaScore({ playing: true, area: 900000 }));
  assert.ok(C.mediaScore({ playing: true, audio: true }) > C.mediaScore({ area: 900000 }));
  assert.ok(C.mediaScore({ playing: true, area: 300000 }) > C.mediaScore({ playing: true, muted: true, area: 20000 }));
});
