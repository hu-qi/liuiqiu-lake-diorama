/**
 * UI 样式（注入到 `<head>`，与 index.html 的暖砂岩色板保持一致）。
 *
 * 设计原则（用户偏好：重视美术呈现）：
 *  - 玻璃拟态卡片 + 极细描边 + 柔和投影，颜色取自沙盘砂岩 / 青铜色板；
 *  - 不遮挡主体构图：工具条贴底居中、信息面板贴右上、标题贴左上；
 *  - Clean 模式一键隐藏所有 UI chrome，便于出图。
 */

const STYLE_ID = 'diorama-ui-style';

export const UI_STYLE = `
.dq-ui { position: fixed; inset: 0; z-index: 7; pointer-events: none; }

.dq-title {
  position: absolute; top: 18px; left: 20px;
  padding: 10px 16px 11px;
  border-radius: 14px;
  background: linear-gradient(160deg, rgba(255,253,248,0.92), rgba(244,239,229,0.86));
  border: 1px solid rgba(138,122,99,0.22);
  box-shadow: 0 10px 28px rgba(94,84,66,0.14);
  backdrop-filter: blur(9px);
  pointer-events: auto; user-select: none;
}
.dq-title h1 {
  margin: 0; font-size: 14px; font-weight: 650; letter-spacing: 0.14em;
  color: #3b352c; text-transform: uppercase;
}
.dq-title p {
  margin: 3px 0 0; font-size: 11px; letter-spacing: 0.06em; color: #7d7261;
}

.dq-toolbar {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 4px;
  padding: 7px 9px; max-width: min(94vw, 980px);
  border-radius: 16px;
  background: linear-gradient(160deg, rgba(255,253,248,0.9), rgba(243,238,228,0.82));
  border: 1px solid rgba(138,122,99,0.24);
  box-shadow: 0 14px 34px rgba(94,84,66,0.16);
  backdrop-filter: blur(10px);
  pointer-events: auto;
}
.dq-btn {
  width: 40px; height: 40px; flex: 0 0 auto;
  display: grid; place-items: center;
  border: none; border-radius: 11px; cursor: pointer;
  background: transparent; color: #5f5749;
  transition: background 0.16s ease, color 0.16s ease, transform 0.16s ease;
}
.dq-btn:hover { background: rgba(138,122,99,0.14); color: #3b352c; }
.dq-btn:active { transform: translateY(1px); }
.dq-btn[aria-pressed="true"] { background: linear-gradient(160deg, #a08a68, #7d6a4d); color: #fff; }
.dq-btn svg { width: 19px; height: 19px; display: block; }
.dq-btn:focus-visible { outline: 2px solid rgba(138,122,99,0.7); outline-offset: 2px; }
.dq-sep { width: 1px; height: 26px; margin: 0 3px; background: rgba(138,122,99,0.22); }

.dq-regions {
  position: absolute; left: 50%; bottom: 70px; transform: translateX(-50%) translateY(6px);
  display: flex; gap: 6px; padding: 7px 9px;
  border-radius: 14px;
  background: linear-gradient(160deg, rgba(255,253,248,0.94), rgba(243,238,228,0.88));
  border: 1px solid rgba(138,122,99,0.24);
  box-shadow: 0 12px 30px rgba(94,84,66,0.18);
  backdrop-filter: blur(10px);
  opacity: 0; pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.dq-regions[data-open="true"] { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
.dq-chip {
  border: 1px solid rgba(138,122,99,0.3); background: rgba(255,255,255,0.5);
  color: #5f5749; font-size: 11.5px; letter-spacing: 0.04em;
  padding: 6px 10px; border-radius: 9px; cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
  white-space: nowrap;
}
.dq-chip:hover { background: rgba(160,138,104,0.18); }
.dq-chip[aria-pressed="true"] { background: linear-gradient(160deg,#a08a68,#7d6a4d); color: #fff; border-color: transparent; }

.dq-info {
  position: absolute; top: 18px; right: 20px; width: 268px;
  padding: 14px 16px 15px;
  border-radius: 15px;
  background: linear-gradient(160deg, rgba(255,253,248,0.94), rgba(243,238,228,0.88));
  border: 1px solid rgba(138,122,99,0.24);
  box-shadow: 0 14px 34px rgba(94,84,66,0.16);
  backdrop-filter: blur(10px);
  pointer-events: auto;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.dq-info[data-visible="false"] { opacity: 0; transform: translateY(-6px); pointer-events: none; }
.dq-info h2 { margin: 0; font-size: 15px; color: #35302a; letter-spacing: 0.02em; }
.dq-info .dq-info-sub { margin: 4px 0 0; font-size: 11px; color: #857a68; letter-spacing: 0.08em; text-transform: uppercase; }
.dq-info dl { margin: 12px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; }
.dq-info dt { font-size: 11px; color: #8a7f6d; letter-spacing: 0.06em; }
.dq-info dd { margin: 0; font-size: 12px; color: #403a31; text-align: right; font-variant-numeric: tabular-nums; }
.dq-info .dq-level {
  display: inline-block; min-width: 30px; text-align: center;
  padding: 1px 7px; border-radius: 999px;
  background: rgba(160,138,104,0.2); color: #6c5c40; font-weight: 600; font-size: 11px;
}
.dq-info .dq-hint { margin: 12px 0 0; font-size: 11px; color: #8a7f6d; line-height: 1.6; }

.dq-clean-exit {
  /* Invisible in Clean mode until hovered/focused, so screenshots stay pure. */
  position: absolute; top: 18px; right: 20px;
  width: 40px; height: 40px; display: none; place-items: center;
  opacity: 0; transition: opacity 0.25s ease;
  border-radius: 12px; cursor: pointer; color: #5f5749;
  border: 1px solid rgba(138,122,99,0.28);
  background: linear-gradient(160deg, rgba(255,253,248,0.92), rgba(243,238,228,0.85));
  box-shadow: 0 10px 26px rgba(94,84,66,0.16);
  backdrop-filter: blur(9px);
  pointer-events: auto;
}
.dq-clean-exit svg { width: 19px; height: 19px; }

body.dq-clean .dq-title,
body.dq-clean .dq-toolbar,
body.dq-clean .dq-regions,
body.dq-clean .dq-info,
body.dq-clean #hud { opacity: 0 !important; pointer-events: none !important; }

body.dq-clean .dq-clean-exit { display: grid; opacity: 0; }
body.dq-clean .dq-clean-exit:hover,
body.dq-clean .dq-clean-exit:focus-visible { opacity: 1; }

@media (max-width: 720px) {
  .dq-info { width: min(72vw, 268px); }
  .dq-title { display: none; }
  .dq-toolbar { max-width: 96vw; gap: 2px; padding: 6px; }
  .dq-btn { width: 34px; height: 34px; }
}
`;

/** 幂等地把样式注入文档。 */
export function injectUiStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = UI_STYLE;
  doc.head.appendChild(style);
}