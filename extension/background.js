/* Route popup commands to exactly one media frame, including cross-origin embeds. */
importScripts('core.js');
const C = globalThis.PaceFit;
const probes = new Map();
let probeId = 0, settingsQueue = Promise.resolve();
function saveSettings(patch) {
  const result = settingsQueue.then(async () => {
    const saved = await chrome.storage.local.get('pacefitSettings');
    const settings = C.sanitize({ ...C.sanitize(saved.pacefitSettings), ...patch });
    await chrome.storage.local.set({ pacefitSettings: settings });
    return settings;
  });
  settingsQueue = result.catch(() => {});
  return result;
}
function savePlayback(patch = {}) {
  const keys = ['manualRate', 'activePreset', 'presetRateA', 'presetRateB'];
  return saveSettings(Object.fromEntries(keys.filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]])));
}
async function contextFor(tabId) {
  const [tab, saved] = await Promise.all([chrome.tabs.get(tabId), chrome.storage.local.get(['pacefitSettings', 'pacefitExcludedDomains'])]);
  const siteHost = C.normalizeDomain(tab.url || '');
  const supported = Boolean(siteHost && siteHost !== 'chromewebstore.google.com' && !(siteHost === 'chrome.google.com' && new URL(tab.url).pathname.startsWith('/webstore')));
  const exclusions = C.normalizeExclusions(saved.pacefitExcludedDomains);
  return { siteHost, supported, exclusions, siteEnabled: Boolean(supported && !C.isExcluded(siteHost, exclusions)), settings: C.sanitize(saved.pacefitSettings) };
}
async function getState(tabId) {
  const context = await contextFor(tabId);
  const token = `${Date.now()}-${++probeId}`;
  const results = [];
  probes.set(token, { tabId, results });
  try {
    await chrome.tabs.sendMessage(tabId, { source: 'pacefit-background', type: 'probe', token }).catch(() => {});
    // sendMessage returns only the first frame response. Other frames report separately.
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally { probes.delete(token); }
  const candidates = results.filter(result => result.state.mediaFound);
  candidates.sort((a, b) => Number(b.state.enabled) - Number(a.state.enabled) || b.state.score - a.state.score || a.frameId - b.frameId);
  const selected = candidates[0] || results.find(result => result.frameId === 0);
  return {
    connected: false, rate: context.settings.manualRate, activePreset: context.settings.activePreset,
    ...selected?.state, ...context, frameId: selected?.frameId ?? 0,
    connected: Boolean(context.siteEnabled && selected?.state.connected),
    supported: context.supported
  };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.source === 'pacefit-content') {
    if (message.type === 'saveRate') {
      savePlayback(message.patch).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
      return true;
    }
    if (message.type === 'report') {
      const probe = probes.get(message.token);
      if (probe && probe.tabId === sender.tab?.id) probe.results.push({ frameId: sender.frameId || 0, state: message.state });
      respond({ ok: true }); return;
    }
    if (message.type === 'context' && sender.tab?.id !== undefined) {
      contextFor(sender.tab.id).then(context => respond({ ok: true, siteHost: context.siteHost })).catch(() => respond({ ok: false }));
      return true;
    }
    if (message.type === 'shortcut' && sender.tab?.id !== undefined) {
      getState(sender.tab.id).then(async state => {
        if (!state.connected || !state.settings.shortcuts) return;
        await chrome.tabs.sendMessage(sender.tab.id, { source: 'pacefit-background', type: 'command', action: message.action, feedback: true }, { frameId: state.frameId });
      }).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
      return true;
    }
    return;
  }
  if (message?.source !== 'pacefit-popup') return;
  const run = async () => {
    if (!Number.isInteger(message.tabId)) throw new Error('탭에 연결하지 못했어요.');
    if (message.type === 'get') return getState(message.tabId);
    if (message.type === 'saveRate') return { settings: await savePlayback(message.patch) };
    if (message.type === 'update') {
      const { manualRate, activePreset, presetRateA, presetRateB, ...preferences } = message.patch || {};
      const settings = await saveSettings(preferences);
      return { settings };
    }
    if (message.type === 'command') {
      const context = await contextFor(message.tabId);
      if (!context.siteEnabled) throw new Error('이 사이트에서는 PaceFit 사용이 꺼져 있어요.');
      const response = await chrome.tabs.sendMessage(message.tabId, { source: 'pacefit-background', type: 'command', action: message.action, value: message.value }, { frameId: Number.isInteger(message.frameId) ? message.frameId : 0 });
      if (!response?.ok) throw new Error(response?.error || '재생할 영상에 연결하지 못했어요.');
      return { ...response.state, ...context, settings: response.state.settings, frameId: message.frameId || 0 };
    }
    throw new Error('알 수 없는 요청입니다.');
  };
  run().then(state => respond({ ok: true, state })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
