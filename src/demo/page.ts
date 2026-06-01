/**
 * Single-page demo shell for evaluators. HTML stays server-rendered so the
 * runtime can serve one deterministic entry page while CSS and JS live as
 * separate assets for easier review, CSP tightening, and line-count control.
 *
 * Element selectors are forbidden by the stylelint defensive-css rule, so
 * every styled element below carries a class — keep new markup paired with
 * a matching `.demo-*` / `.form-*` / `.btn-*` hook in `demo.css`.
 */

import { HAZARD_ZONES } from "../data/hazard-zones.ts";
import { LABELS_BY_LOCALE } from "./labels.ts";
import { DEMO_SHELTERS } from "./shelters.ts";

const demoHazardZones = HAZARD_ZONES.map((zone) =>
	zone.id === "hualien-mataian-flood-demo"
		? { ...zone, name: "馬太鞍溪 demo 河道影響區" }
		: zone,
);

const demoLabelsJson = JSON.stringify(LABELS_BY_LOCALE).replaceAll(
	"<",
	"\\u003c",
);
const demoHazardZonesJson = JSON.stringify(demoHazardZones).replaceAll(
	"<",
	"\\u003c",
);
const demoSheltersJson = JSON.stringify(DEMO_SHELTERS).replaceAll(
	"<",
	"\\u003c",
);

export const demoHtml = `<!doctype html>
<html lang="zh-Hant-TW" class="demo-root">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>燕尾榫 — Demo</title>
<link rel="stylesheet" href="/demo.css">
</head>
<body class="demo-body">

<header class="demo-header">
  <h1 class="demo-title">燕尾榫 Demo MVP</h1>
  <span class="sub">離網 LoRa 通報 / AEAD round-trip / 花蓮公開地理合成情境</span>
  <span class="synthetic-badge" title="通報內容為 synthetic；座標為公開地理 reference points">Synthetic reports · public geography</span>
</header>

<main class="demo-main">

  <section class="panel">
    <h2 class="panel-title">① 通報端 <span class="pill">通報節點 + GNSS</span></h2>
    <p class="note">預設情境是在公開地理 reference points 上展示 synthetic reports; 不代表真實人物與案例。</p>

    <label class="form-label">情境</label>
    <select id="scenario" class="form-input"></select>
    <p id="scenario-desc" class="note"></p>

    <label class="form-label">本情境封包</label>
    <pre id="scenario-packets" class="code-block"></pre>

    <div class="row">
      <button id="btn-encode" class="btn btn-primary" type="button">編碼 → Hex</button>
      <button id="btn-send" class="btn btn-safe" type="button">送至接收端分析</button>
    </div>
  </section>

  <section class="panel">
    <h2 class="panel-title">② 協議層 <span class="pill">AEAD round-trip</span></h2>
    <p class="note">Web demo 使用 AES-128-GCM; 硬體 device profile 可採 AES-128-CCM. 兩者皆為 AEAD, packet / AAD 結構不變。</p>

    <label class="form-label">加密後 Hex (40/29/36 bytes per type)</label>
    <pre id="hex-output" class="code-block"></pre>

    <div class="row">
      <button id="btn-decode" class="btn" type="button">解密驗證</button>
    </div>

    <label class="form-label">解密 JSON</label>
    <pre id="decode-output" class="code-block"></pre>
  </section>

  <section class="panel">
    <h2 class="panel-title">③ 接收端 <span class="pill">Synthetic queue</span></h2>
    <p class="note">事件佇列優先: 同鄉鎮分桶, 近距離同類事件群聚, 排序後再給決策者看。</p>

    <label class="form-label">Display language</label>
    <select id="locale" class="form-input">
      <option value="zh-Hant-TW">正體中文</option>
      <option value="en-US">English</option>
    </select>

    <label class="form-label">Hazard overlay</label>
    <div class="hazard-controls">
      <label class="inline-control">
        <input id="hazard-toggle" class="toggle" type="checkbox" checked>
        <span>顯示公開 hazard layer</span>
      </label>
      <label class="opacity-control">
        <span>透明度</span>
        <input id="hazard-opacity" class="slider" type="range" min="20" max="100" value="72">
        <output id="hazard-opacity-value" class="hazard-opacity-readout" for="hazard-opacity">72%</output>
      </label>
    </div>
    <div id="hazard-map" class="hazard-map" aria-label="Hazard overlay map">
      <svg id="hazard-map-svg" class="hazard-map-canvas" role="img" aria-labelledby="hazard-map-title"></svg>
      <div id="hazard-summary" class="hazard-summary"></div>
    </div>
    <div class="hazard-legend" aria-label="Hazard 圖例">
      <div class="legend-title">Hazard 圖例</div>
      <span class="legend-row"><i class="legend-swatch river-corridor"></i>馬太鞍溪 demo 影響區（藍 + 點紋）</span>
      <span class="legend-row"><i class="legend-swatch landslide"></i>土石流 / 大規模崩塌靜態層（橘紅 + 斜線）</span>
      <span class="legend-row"><i class="legend-swatch terrain-event"></i>terrain_event 通報點位（紫紅三角）</span>
      <span class="legend-row"><i class="legend-swatch in-zone"></i>分析命中封包點位（綠點 + 虛線環）</span>
      <small class="legend-source">資料來源：農業部土石流 / 大規模崩塌潛勢圖（政府資料開放授權 1.0，已隱碼）與 synthetic event boundary · 色盤 Okabe-Ito 對色盲友善 · 詳見 README Data Attribution</small>
    </div>

    <label id="queue-title" class="form-label">事件佇列</label>
    <div id="queue-groups" class="queue"></div>

    <label class="form-label">群組明細</label>
    <div id="queue-detail"></div>

    <label class="form-label">事實觸發 (rule-based)</label>
    <p class="note">只列 deterministic 規則觸發；未觸發時顯示本情境無觸發。觸發條件見 SPEC.md。</p>
    <div id="alerts"></div>

    <label class="form-label">彙總摘要</label>
    <div id="view-summary"></div>

    <label class="form-label">原始分析 JSON</label>
    <pre id="analysis-output" class="code-block"></pre>
  </section>

</main>

<footer class="demo-footer">
  <a class="demo-link" href="/api/openapi.json">OpenAPI (JSON)</a> ·
  <a class="demo-link" href="/api/docs">API Docs</a> ·
  <a class="demo-link" href="https://github.com/codewoods/dovetail">Repo</a> ·
</footer>

<script id="demo-labels" type="application/json">${demoLabelsJson}</script>
<script id="demo-hazard-zones" type="application/json">${demoHazardZonesJson}</script>
<script id="demo-shelters" type="application/json">${demoSheltersJson}</script>
<script type="module" src="/demo.js"></script>

</body>
</html>`;
