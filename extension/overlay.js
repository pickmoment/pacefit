(() => {
  'use strict';
  const C = globalThis.PaceFit;
  C.createOverlay = () => {
    const host = document.createElement('div'); host.id = 'pacefit-controller';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{position:fixed!important;top:var(--pacefit-top,14px)!important;left:var(--pacefit-left,14px)!important;z-index:2147483647!important;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;color:#f7f8ef!important;line-height:1.4!important;letter-spacing:0!important;text-align:left!important;pointer-events:none!important;color-scheme:dark}
      *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;color:inherit}button:focus-visible,input:focus-visible{outline:3px solid #d9f27e;outline-offset:3px}button:disabled{opacity:.45;cursor:default}[hidden]{display:none!important}
      .controls{opacity:0;pointer-events:none;transition:opacity .15s}:host([data-hovered]) .controls,.controls:has(:focus-visible){opacity:1;pointer-events:auto}
      .feedback{position:absolute;top:0;left:0;min-width:108px;white-space:nowrap;height:38px;padding:0 14px;display:flex;align-items:center;justify-content:center;border:1px solid #ffffff38;border-radius:12px;background:#20372ef0;box-shadow:0 2px 12px #0002;color:#d9f27e;font:600 15px ui-monospace,SFMono-Regular,monospace;opacity:0;pointer-events:none;transition:opacity .15s}:host([data-feedback]) .feedback{opacity:1}:host([data-hovered][data-controls-enabled]) .feedback,.controls:has(:focus-visible)~.feedback{opacity:0}
      .bar{display:flex;align-items:center;width:max-content;border:1px solid #ffffff38;border-radius:12px;background:#20372ef0;box-shadow:0 2px 12px #0002;opacity:.85;transition:opacity .15s}.bar:hover,.bar:focus-within,.bar.open{opacity:1}
      .bar button{border:0;background:none;min-width:36px;height:36px;padding:0 9px;font-size:19px}.bar button:hover{background:#ffffff12}.bar button:first-child{border-radius:11px 0 0 11px}.bar button:last-child{border-radius:0 11px 11px 0}.bar #speed{font:600 13px ui-monospace,SFMono-Regular,monospace;color:#d9f27e;min-width:92px;border-left:1px solid #ffffff18;border-right:1px solid #ffffff18}
      .panel{width:260px;margin-top:7px;padding:14px;border:1px solid #ffffff30;border-radius:14px;background:#20372efa;box-shadow:0 8px 24px #0004}.heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:11px;color:#cbd8c7}.heading button{width:28px;height:28px;margin:-7px -6px -7px 0;border:0;background:none;font-size:20px}
      .presets{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.presets button,.actions button{border:1px solid #6b7b60;border-radius:7px;background:none;padding:8px 3px;font:11px ui-monospace,SFMono-Regular,monospace;min-height:34px}.presets button[aria-pressed=true]{background:#d9f27e;color:#20372e;border-color:#d9f27e}.presets button:hover,.actions button:hover{border-color:#d9f27e}input[type=range]{width:100%;margin:16px 0;accent-color:#d9f27e;cursor:pointer}.actions{display:flex;gap:7px}.actions button{flex:1;font:11px -apple-system,BlinkMacSystemFont,sans-serif}.help{margin:12px 0 0;color:#aebda7;font-size:10px}.sr{position:absolute;width:1px;height:1px;clip:rect(0,0,0,0);overflow:hidden}
      .slot-presets{grid-template-columns:repeat(2,1fr);margin-bottom:8px}
      @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    </style>
    <div class="controls"><div class="bar" role="group" aria-label="PaceFit 배속 조절">
      <button id="slower" type="button" aria-label="배속 낮추기">−</button>
      <button id="speed" type="button" aria-label="배속 메뉴 열기" aria-expanded="false" aria-controls="panel">1×</button>
      <button id="faster" type="button" aria-label="배속 높이기">+</button>
    </div>
    <section id="panel" class="panel" aria-label="빠른 배속 메뉴" hidden>
      <div class="heading"><span>PaceFit · 빠른 배속</span><button id="close" type="button" aria-label="배속 메뉴 닫기">×</button></div>
      <div class="presets slot-presets" role="group" aria-label="전환 프리셋"><button id="preset-a" type="button" aria-pressed="true">A · 1×</button><button id="preset-b" type="button" aria-pressed="false">B · 2×</button></div>
      <div class="presets" role="group" aria-label="배속 프리셋">${C.PRESETS.map(n => `<button type="button" data-rate="${n}" aria-pressed="false">${C.format(n)}</button>`).join('')}</div>
      <label class="sr" for="slider">재생 배속</label><input id="slider" type="range" min="0.25" max="4" step="0.05" value="1">
      <div class="actions"><button id="toggle" type="button">A ↔ B 전환</button><button id="favorite" type="button">★ 1.5×</button></div>
      <p class="help">배속을 조절하면 선택한 A·B에 저장돼요.</p>
      <p id="help" class="help">[ 느리게 &nbsp; ] 빠르게 &nbsp; \\ A ↔ B 전환</p>
    </section></div><div id="feedback" class="feedback" aria-hidden="true">A · 1×</div><span id="announcement" class="sr" role="status" aria-live="polite"></span>`;
    return { host, shadow };
  };
})();
