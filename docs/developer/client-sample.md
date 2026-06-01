# Client Sample Code

對應簡章 §七(二) 7 / 8。本作品含兩元件，分別有 client 範例：

- **call-component** (Library) — Node / Bun import + 瀏覽器 Web Crypto
- **analysis-component** (API Service) — HTTP fetch + curl

依賴：Bun ≥ 1.3 或 Node ≥ 22；瀏覽器需支援 Web Crypto AES-GCM。

---

## 1. analysis-component (API Service)

The coordinates in these examples are public reference coordinates used by
synthetic reports. They keep their decimal precision so deterministic overlay
tests hit the intended reference point and do not drift toward unrelated private
locations through rounding. They must not be interpreted as real household,
sheltering, rescue, or resource-status claims.

### 1.1 列出 5 個預設 scenario

```sh
curl -sS http://localhost:9000/api/scenarios | jq '.[].label'
```

```js
const scenarios = await fetch("http://localhost:9000/api/scenarios").then((r) => r.json());
console.log(scenarios.map((s) => s.label));
// ["情境一 村里幹事巡視", "情境二 撤離車輛抵達", ...]
```

### 1.2 Demo helper: 編碼 packet 成 hex（AES-128-GCM 加密）

`/api/codec/*` 是評審 demo helper，不是正式 production integration API。正式系統可直接 import `src/packet/codec.ts` 或依 `SPEC.md` 實作 codec。

```js
const sample = {
  packet: {
    type: "person_report",
    envelope: {
      received_at: "2026-09-23T14:32:11Z",
      gateway_id: "TW-HUA-GFG-001",
      aead_profile: "aead-gcm-128",
      chain_mac: "00",
    },
    packet: {
      mac: "5C8AF3000001",
      village: 1003012,
      ts: 1759058400,
      lat: 23.661234,
      lng: 121.421789,
      alt: 130,
      addr: "MOCK01",
      count: 3,
      status: "evacuated_shelter",
      flags: ["on_site"],
    },
  },
};

const { hex, counter, size } = await fetch("http://localhost:9000/api/codec/encode", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(sample),
}).then((r) => r.json());

console.log(counter, size, hex);  // 1 40 01ef907723c91d73f325ecdce1b1545b6611566966fb6e3720cbc631938e92ed...
```

### 1.3 Demo helper: 解密 hex 回 packet JSON

```js
const decoded = await fetch("http://localhost:9000/api/codec/decode", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ hex, counter, mac: "5C8AF3000001" }),
}).then((r) => r.json());

console.log(decoded.packet.packet.status);  // evacuated_shelter
console.log(decoded.verified);              // true
```

### 1.4 批次送 packet → 聚合分析 + 事實觸發

```js
const scenarios = await fetch("http://localhost:9000/api/scenarios").then((r) => r.json());
const packets = scenarios[0].packets;

const result = await fetch("http://localhost:9000/api/packets", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(packets),
}).then((r) => r.json());

console.log(result.alerts);          // deterministic fact triggers
console.log(result.summary);         // village × status × flags
console.log(result.overlays);        // packet × hazard polygon
```

### 1.5 靜態危險區查詢 (point-in-polygon)

```js
const hazardZone = await fetch("http://localhost:9000/api/hazard-zone?lat=23.661234&lng=121.421789")
  .then((r) => r.json());

console.log(hazardZone.zone.inZone);          // true / false
console.log(hazardZone.zone.zoneName);        // 馬太鞍溪堰塞湖影響區
console.log(hazardZone.location.admin2);      // Guangfu Township
```

### 1.6 OpenAPI 3.1 spec

```sh
curl -sS http://localhost:9000/api/openapi.json | jq '.info'
```

```js
const spec = await fetch("http://localhost:9000/api/openapi.json").then((r) => r.json());
console.log(spec.paths);
```

---

## 2. call-component (Library)

### 2.1 直接 import 編解碼（Bun / Node ≥ 22）

```ts
import {
  encodePersonReport, decodePersonReport, keyFromHex,
} from "./src/packet/codec.ts";

const key = await keyFromHex("00112233445566778899aabbccddeeff");

const frame = await encodePersonReport({
  mac: "5C8AF3000001",
  village: 1003012,
  ts: 1759058400,
  lat: 23.661234,
  lng: 121.421789,
  alt: 130,
  addr: "MOCK01",
  count: 3,
  status: "evacuated_shelter",
  flags: ["on_site"],
}, key, 1);

console.log(frame.length);   // 40

const macBytes = Uint8Array.from([0x5C, 0x8A, 0xF3, 0x00, 0x00, 0x01]);
const decoded = await decodePersonReport(frame, key, 1, macBytes);
console.log(decoded.status); // evacuated_shelter
```

### 2.2 在瀏覽器（Web Crypto）

```html
<script type="module">
import { encodePersonReport, keyFromHex } from "./codec.js";

const key = await keyFromHex("00112233445566778899aabbccddeeff");
const frame = await encodePersonReport({ /* ... */ }, key, 1);

document.body.textContent = Array.from(frame, (b) => b.toString(16).padStart(2, "0")).join("");
</script>
```

---

## 3. 完整端到端流程

```sh
#!/usr/bin/env bash
# 1. 啟動 Worker
bun run dev &
sleep 3

# 2. 抓 scenario
PACKETS=$(curl -sS http://localhost:9000/api/scenarios | jq '.[3].packets')

# 3. 取得告警
curl -sS -X POST http://localhost:9000/api/packets \
  -H 'content-type: application/json' \
  -d "$PACKETS" | jq '.alerts'
```

預期輸出（情境 4 複合災害失蹤）：

```json
[
  { "id": "rescue_needed", "severity": "critical", "message": "1 人需要救援", "refs": ["status_totals.rescue_needed"] },
  { "id": "trapped", "severity": "critical", "message": "4 人受困", "refs": ["flag_totals.trapped"] },
  { "id": "address_lost", "severity": "critical", "message": "3 戶原址消失", "refs": ["status_totals.address_lost"] },
  { "id": "packets_in_hazard_zone", "severity": "warning", "message": "...", "refs": [...] }
]
```

---

## 4. 依賴與版本

| 工具 | 最低版本 | 用途 |
|---|---|---|
| Bun | 1.3 | runtime + bundler + test runner (本 repo 預設) |
| Node | 22 | 替代 runtime（須 Web Crypto AES-GCM 32-bit tag） |
| GDAL | 3.12 | build-time 開放資料 pipeline |
| Vitest | 4 | 測試 |
| TypeScript | 5.9 | typecheck |

---

## 5. 錯誤處理

| HTTP | 原因 | 處理 |
|---|---|---|
| 400 invalid_json | packet batch 非 JSON 陣列 | 檢查 Content-Type 與 body 格式 |
| 400 expected_array | packet batch 不是陣列 | wrap with `[...]` |
| 400 invalid_lat_lng | 緯經度超出範圍或 NaN | 確認 query 參數可解析為 number |
| 400 (decode) | AEAD 驗證失敗（counter 不對 / 金鑰錯 / frame 被篡改） | 檢查 counter, key, frame size |
| 404 not_found | route 不存在 | 檢查 path |

---
