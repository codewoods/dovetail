# SPEC — 離網災情通報協議

> 對應簡章 §七(二) 3 / §七(二) 9 (OpenAPI)。

## 0. 範圍

本協議定義「在地通報節點 → 政府接收端」的封包格式與傳輸層介面。**不**定義：政府端內部資料庫 schema、AI 推論模型、撤離演練流程。

## 1. 元件型態（簡章 §七(三)）

| 元件 | 型態 | 部署 |
|---|---|---|
| call-component | Library / Package | `npm install`；瀏覽器 / Node / Bun |
| analysis-component | API Service | Bun / Node / Docker（任何 fetch-compatible host） |

兩元件透過標準 JSON 介面對接，互相獨立可替換。

## 2. 封包總覽

| Type | 名稱 | Size | 用途 |
|---|---|---|---|
| 0x01 | person_report | 40 bytes | 人員狀態通報 |
| 0x02 | terrain_event | 29 bytes | 地形事件通報 |
| 0x03 | resource_report | 36 bytes | 資源提供 / 請求 |

封包為「應用層」內容；應用封包受 AEAD 保護不可竄改。Gateway 另以 `chain_mac` 記錄接收稽核鏈。

## 3. AEAD Profile（雙軌）

| Profile | 環境 | 演算法 | 函式庫 |
|---|---|---|---|
| `aead-gcm-128` | Web / Bun MVP | AES-128-GCM | Web Crypto (stdlib) |
| `aead-ccm-128` | 相容硬體 device profile | AES-128-CCM | mbedTLS |

兩 profile 共用同一份 plaintext schema；接收端依封包 envelope 標頭欄位選擇驗證 profile。AEAD tag 含於封包尾段，**不另設獨立 HMAC 欄位**（避免重複 packet authentication）。

目前兩個 profile 都是 **32-bit constrained** tag profile，用於低頻寬、封閉部署、短封包通報；not a general-purpose high-assurance profile。若頻寬或合規要求允許，production profile 應優先評估 64-bit 以上 tag；GCM profile 優先使用 96-bit 或 128-bit tag。ChaCha20-Poly1305 是合理 AEAD 候選，但不是本協議目前的 interoperable baseline；若未來採用，必須新增獨立 profile，並同步 Web/Bun runtime、device firmware、OpenAPI、fixture 與 contract tests。

### Nonce 構成（12 bytes）

```
nonce = device_mac (6B) || packet_counter (4B) || packet_type (1B) || reserved (1B)
```

`packet_counter` 在 nonce 建構前必須是實際 u32 值；不接受字串、浮點、null、coerce 後的值。`packet_type` 為封包 offset 0 的 type byte（`0x01`、`0x02`、`0x03`），同時作為 AEAD AAD。接收端必須先驗證 u32 counter 與 u8 type 前置條件，再把 counter / type 帶入 nonce 建構。韌體單調遞增；因 type byte 已進入 nonce，counter 可採 per-(device_mac, packet_type) 單調狀態，但同一 `(device_mac, packet_type, packet_counter)` 不得重複。接收端在 nonce window（±300s 時戳 + counter）內偵測 replay。

### Key 來源

- 預燒金鑰：合規通報設備出廠或部署時燒入 device key
- Rotation：依政府端管理機關 KMS 規範，本協議不定義 rotation 排程

### Gateway key rotation boundary

MVP analysis-component 使用 single active gateway MAC key（`DOVETAIL_GATEWAY_MAC_KEY_HEX`）驗證 decoded JSON 的 `chain_mac`，不實作 `kid` 選擇或多 key verifier。Production gateway / KMS 若需要 rotation，必須在本元件外維護 `kid` 與 key state：active signing、verify-only retire window、retired / revoked。`kid` 屬 gateway audit metadata，不進入低頻寬 packet spine；若 production gateway envelope 對外揭露 `kid`，該欄位必須與其他 gateway inputs 一起做 canonical length-framed MAC，避免事後改寫 key identity。verify-only retire window 結束後，舊 `kid` 必須 fail-closed，不得繼續接受新 batch。

## 4. 封包欄位

### 4.1 Type 0x01 person_report (40 bytes)

| Offset | Field | Size | Type | 說明 |
|---|---|---|---|---|
| 0 | type | 1 | u8 | `0x01`，作為 AEAD AAD（associated data） |
| 1 | mac | 6 | bytes | 通報設備 MAC |
| 7 | village | 4 | u32 LE | 村里代碼（民政司） |
| 11 | ts | 4 | u32 LE | Unix 時戳（GNSS 校時） |
| 15 | lat | 4 | i32 LE | 緯度 fixed-point × 1e7 |
| 19 | lng | 4 | i32 LE | 經度 fixed-point × 1e7 |
| 23 | alt | 2 | i16 LE | 海拔（公尺） |
| 25 | addr | 7 | bytes | TGOS 壓縮編碼 / 字典代碼 |
| 32 | count | 1 | u8 | 觀察人數 |
| 33 | status | 1 | u8 | 人員狀態列舉 |
| 34 | flags | 2 | u16 LE | bitmap |
| 36 | aead_tag | 4 | bytes | AEAD authentication tag (32-bit) |

註：plaintext = offsets 1-35（35 bytes）；type byte 作 AAD 不加密。AEAD tag 取 32-bit（Web Crypto AES-GCM 支援；硬體 CCM profile 同 32-bit tag）。

### 4.2 Type 0x02 terrain_event (29 bytes)

| Offset | Field | Size | Type |
|---|---|---|---|
| 0 | type | 1 | u8 (`0x02`) |
| 1 | mac | 6 | bytes |
| 7 | ts | 4 | u32 LE |
| 11 | lat | 4 | i32 LE |
| 15 | lng | 4 | i32 LE |
| 19 | event | 1 | u8 |
| 20 | extent_m | 2 | u16 LE |
| 22 | severity | 1 | u8 (0-255, 4-band 通行/撤離尺度, 詳 §5.7) |
| 23 | flags | 2 | u16 LE |
| 25 | aead_tag | 4 | bytes | AEAD authentication tag (32-bit) |

terrain_event plaintext = offsets 1-24（24 bytes）, type 為 AAD。

### 4.3 Type 0x03 resource_report (36 bytes)

| Offset | Field | Size | Type |
|---|---|---|---|
| 0 | type | 1 | u8 (`0x03`) |
| 1 | mac | 6 | bytes |
| 7 | ts | 4 | u32 LE |
| 11 | lat | 4 | i32 LE |
| 15 | lng | 4 | i32 LE |
| 19 | addr | 7 | bytes |
| 26 | resource | 2 | u16 LE bitmap |
| 28 | quantity | 1 | u8 |
| 29 | duration | 1 | u8（小時） |
| 30 | flags | 2 | u16 LE |
| 32 | aead_tag | 4 | bytes | AEAD authentication tag (32-bit) |

resource_report plaintext = offsets 1-31（31 bytes）, type 為 AAD。

## 5. 列舉

### 5.1 person_report.status (u8)

```
0  unknown                   未確認（合法通報結果，不等於失職）
1  evacuated_shelter         撤離至避難收容處所
2  evacuated_relatives       依親
3  vertical_evacuated        垂直避難
4  refused                   拒絕撤離
5  rescue_needed             需要救援
6  self_evacuated_neighbor   鄰居代報已自行離開
7  address_lost              原址消失（土石流 / 倒塌）
```

### 5.2 person_report.flags (u16 bitmap)

```
bit  0  injured              受傷
bit  1  special_needs        避難支援需求（不揭露細分類）
bit  2  long_term_care       長照個案
bit  3  trapped              受困
bit  4  non_resident         非設籍當地
bit  5  foreign_visitor      外籍訪客
bit  6  migrant_worker       外籍移工
bit  7  status_changed       狀態再次變化
bit  8  on_site              現場通報（非遠端推測）
bit  9  vertical_evacuation  垂直避難已確認
bit 10  no_fixed_address     無固定住所
bit 11  gnss_degraded        GNSS 訊號異常
bit 12  requires_separated_space  當事人主動表達需區隔空間（311 經驗）
bit 13  consent_acknowledged 外接操作介面確認被通報（雙層分離）
bit 14  consent_refused      當事人拒絕被通報, status 維持 unknown
bit 15  保留
```

`special_needs` 是 umbrella support flag，用來表示「此人或此群體在避難、安置或持續照護上需要額外確認」。它涵蓋但不細分：年幼兒童、孕產婦、照顧者不在場的受照顧者、行動不便、長照或其他地方 SOP 認定的避難弱勢。封包不得把這些原因拆成更細身分類別；必要細節留在授權單位內部流程。若同一地點同時有一般人與 `special_needs` 對象，應拆成不同 `person_report`，避免 flag 套用到整筆 `count`。

當 `special_needs` 代表可執行的資源需求時，現場或接收端可另送 `resource_report`，例如 `medical_aid`、`shelter_space`、`food_water`、`warmth_supplies`。`person_report` 只表達人員狀態與支援需求，不取代醫療、社福或避難收容處所個案管理。

### 5.3 terrain_event.event (u8)

```
已發生事件：
1  road_blocked
2  bridge_collapsed
3  landslide
4  flood
5  building_collapse
6  fire
7  river_diverted
8  power_outage_area
9  signal_lost

人類觀察早期訊號：
10 water_color_change       水變色
11 mountain_rumbling        山鳴
12 sudden_animal_behavior   動物行為異常
13 ground_cracking          地面龜裂
14 unusual_smell            異常氣味

水文 / 排水機制：
15 drainage_backflow        排水回堵壅高（如支流欲排入主河道但主河道高水位）
```

`flood` 表示現場已發生積淹水結果；`drainage_backflow` 表示造成淹水的排水 / 河川水位機制。兩者可同時由不同封包通報。

### 5.4 terrain_event.flags (u16 bitmap)

```
bit 0  rapid_rainfall       短延時強降雨
bit 1  only_exit_control    道路只出不進 / 預警性封閉
bit 2  vehicles_trapped     車輛或人員暫時受困
bit 3  backflow_observed    已觀察到水流回堵或倒灌
bit 4-15  保留
```

### 5.5 resource_report.resource (u16 bitmap)

```
bit 0  vehicle_transport     交通工具
bit 1  shelter_space         收容空間
bit 2  power_generator       發電設備
bit 3  medical_aid           醫療協助
bit 4  food_water            食物飲水
bit 5  communication         通訊設備
bit 6  fuel                  燃料
bit 7  manpower              人力協助（可帶 skills metadata）
bit 8  warmth_supplies       保暖物資 / 乾衣 / 棉被
bit 9  menstrual_supplies    生理用品
bit 10-15  保留
```

### 5.6 resource_report.flags (u16)

```
bit 0  is_request    請求資源（否則為提供）
bit 1  urgent        緊急
bit 2-15  保留
```

### 5.7 terrain_event.severity 評估狀態準則

severity 是現場觀察者人眼判斷, **非感測器數值**, 不取代氣象局雨量站、水利署水位站、交通部監視器等政府感測來源。框架以通行 / 撤離可行性為主, 不評估安全, 不做災害預測。

| u8 區間 | 級別 | 通行 / 撤離可行性 |
|---|---|---|
| `0` | 觀察 | 訊號記錄, 通行無影響 |
| `1-127` | 民眾受限 | 民眾車輛應繞行; 行人 / 4WD 可通行撤離 |
| `128-191` | 工程級 | 一般車輛不可; 工程 / 4WD / 救災可進 |
| `192-255` | 救災級 / 封閉 | 民眾工程不可; 救災通行視現場判斷 |

**操作介面建議**: 4 個等級可對應按鍵、旋鈕、觸控或 companion 裝置選單；device profile 可存中位數 (0 / 64 / 160 / 224)。協議允許 u8 0-255 連續, 為未來感測器整合留空間, MVP 階段只接受觀察分級。

**資料來源**: 第 1 層 persona (村里幹事 / 巡守隊 / 在地長者 / 避難收容處所管理員), 單一觀察者到場當下評估狀態。

**偵測時機**: 第一次到場觀察當下發送; 狀況變化 (惡化 / 緩解) → 同位置新增 packet, gateway 端依 `packet.ts` 排序與去重 (本協議不持久化狀態)。

**時序邊界 / 與政府感測落差**: 本協議封包以 `packet.ts` 為準, **不對齊也不內插**政府感測來源時序。地方政府與中央各自有水情 / 災害 / 交通感測系統, 時序可能落差數分鐘至數十分鐘; 跨源比對由 gateway / analysis-component / 政府端在已知時間誤差下處理。避免將 `severity` 解讀為「感測器讀數」或「災害預測」, 詳 `LIMITATIONS.md` §9。

## 6. Addr 欄位與地址識別碼

7 bytes 編碼：tag(1) || payload(6)。Tag 區分類別；payload 為 TGOS 二進位代碼或全零（字典項目）。封包中的 `addr` 不是門牌地址，也不應放入「光復鄉○○街 ○○ 號」這類可讀地址。

操作介面可以讓村里幹事在外接螢幕上看到人類可讀地址；裝置實際儲存與傳輸的是該裝置生成或查表得到的不可逆短碼。接收端中介 server 再依政府持有的對照資料轉成[地址識別碼](https://adrid.moi.gov.tw/)；救援人員需要定位時，由授權系統提供定位或地址資訊。公開 demo 一律使用 `MOCKxx` addr 代碼，避免看起來像真實門牌或政府內碼。

| Tag | 類別 | Payload 用途 |
|---|---|---|
| 0x00 | TGOS standard | 6 bytes 二進位 TGOS code（或 ASCII 截斷至 6 字） |
| 0x10-0x1F | UNKNOWN_* | 全零 |
| 0x20-0x2F | NO_ADDRESS / TRANSIENT / VEHICLE | 全零 |
| 0x30-0x3F | 短期停留場域 | 全零 |

| Label | Tag | 備註 |
|---|---|---|
| `UNKNOWN_LANDSLIDE` | 0x10 | 土石流區 |
| `UNKNOWN_FLOOD` | 0x11 | 淹沒區 |
| `UNKNOWN_FIRE` | 0x12 | 火災區 |
| `UNKNOWN_COLLAPSE` | 0x13 | 倒塌區 |
| `NO_ADDRESS_LOCAL` | 0x20 | 轄區內無住居地址者 |
| `NO_ADDRESS_EXTERNAL` | 0x21 | 轄區外無住居地址者 |
| `TRANSIENT` | 0x22 | 臨時過境 |
| `VEHICLE` | 0x23 | 車內避難 |
| `CAMPSITE_OFFICIAL` | 0x30 | 合法露營區 |
| `CAMPSITE_WILD` | 0x31 | 野營 |
| `GROUP_TOUR` | 0x32 | 團體遊客 |
| `WORKSITE` | 0x33 | 施工現場 |
| `ARTIST_RESIDENCY` | 0x34 | 駐村場域 |
| `FESTIVAL_VENUE` | 0x35 | 藝術節 / 活動場域 |
| `MOBILE_VENDOR` | 0x36 | 流動攤販 |

TGOS 標準門牌的 payload 6 bytes 在 MVP 階段以 ASCII 短碼展示（公開 demo 使用 `MOCK01` 這類 mock code）；production profile 應改採政府端可解析、封包外不可逆的地址識別碼。

```
標準門牌：
"CNC5630-5"               TGOS 地址識別碼

地形災害後標識：
"UNKNOWN_LANDSLIDE"       土石流區
"UNKNOWN_FLOOD"           淹沒區
"UNKNOWN_FIRE"            火災區
"UNKNOWN_COLLAPSE"        倒塌區

無門牌人員：
"NO_ADDRESS_LOCAL"        轄區內無住居地址者
"NO_ADDRESS_EXTERNAL"     轄區外無住居地址者
"TRANSIENT"               臨時過境
"VEHICLE"                 車內避難

短期停留場域：
"CAMPSITE_OFFICIAL"       合法露營區
"CAMPSITE_WILD"           野營
"GROUP_TOUR"              團體遊客
"WORKSITE"                施工現場
"ARTIST_RESIDENCY"        駐村場域
"FESTIVAL_VENUE"          藝術節 / 活動場域
"MOBILE_VENDOR"           流動攤販
```

## 7. JSON 輸出 schema

封包經 USB Serial 送至接收端後，解密為以下 JSON（analysis-component HTTP 介面也接此格式）。以下為 synthetic report 範例；座標是 public reference coordinate，用於 deterministic overlay tests。保留小數精度是為避免 rounding 漂移到不相關的私人地點，不代表真實個案、收容狀態、救援狀態或資源需求：

```json
{
  "type": "person_report",
  "envelope": {
    "received_at": "2025-09-28T11:20:10Z",
    "gateway_id": "MOCK-HUA-GFG-001",
    "aead_profile": "aead-gcm-128",
    "chain_mac": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "packet": {
    "mac": "5C8AF3000001",
    "village": 1003012,
    "ts": 1759058400,
    "lat": 23.661234,
    "lng": 121.421789,
    "alt": 130,
    "addr": "MOCK01",
    "count": 6,
    "status": "evacuated_shelter",
    "flags": ["on_site"]
  }
}
```

對應 JSON Schema 由 `GET /api/openapi.json` 提供；可送出的批次範例見 `examples/packets-batch.json`。

### 7.1 event_queue 顯示排序政策

`event_queue` 是接收端檢視工具，不是風險評估工具。`severity` / `maxSeverity` 在此輸出中代表 **顯示排序權重**：當大量通報同時湧入，analysis-component 依權重、事件類型、時間與行政區聚合結果決定列表與地圖上先呈現哪些項目，避免關鍵通報被資料洪流淹沒。

允許用途：

- 顯示優先序：列表排序、地圖標記視覺權重、群組明細的預設檢視順序。
- 接收端檢視提示：提醒操作者先看哪些群組與來源封包索引。
- 低頻寬彙整：將鄰近同類通報合併顯示，減少密集標記造成的視覺噪音。

禁止用途：

- 不代表「這個人 / 事件有多危險」。
- 不代表政府、消防、警察、國軍、NGO 或地方協力者「該先派員去哪」。
- 不代表撤離、處置、救援、醫療檢傷或資源分配優先序。

`config/queue-policy.json` 的預設值只描述檢視權重：

- `personStatusSeverity.unknown = 140` 與 `refused = 140`：前者是狀態不明，後者是明確拒絕撤離；兩者都需要在接收端可見，但不推論誰更危險。
- `rescue_needed = 220` 與 `address_lost = 220`：明確求救或原址消失應優先被看見，但仍不是派遣命令。
- 已撤離狀態（`evacuated_shelter`、`evacuated_relatives`、`vertical_evacuated`、`self_evacuated_neighbor`）為 60：不是「不重要」，而是資料已顯示已得到階段性照顧，可在檢視排序中排後。
- `priorityOrder` 的預設順序是同權重時的檢視順序：`rescue_needed`、`address_lost`、`landslide`、`drainage_backflow`、`flood`、`resource_report:request`。這是「先讓操作者看到」的順序，不是「先處理」的順序。
- `clusterRadiusDeg = 0.003` 約等於緯度方向 333 公尺，用於把鄰近同類通報合併成同一顯示群組；它不宣稱半徑內的人屬於同一事件、同一家庭或同一救援單位。

## 8. Gateway Chain MAC

正式 gateway 可產生 append-only audit chain。MVP repo 提供 `src/analysis/chain-mac.ts` 純函式與測試展示演算法；key rotation 屬 production gateway 責任。analysis-component 預設 demo 模式只驗證 `chain_mac` shape；當 server-side `DOVETAIL_GATEWAY_MAC_KEY_HEX` 存在，HTTP ingress 進入 production gateway verification mode，會在分析前驗證 `chain_mac` 值並維護 process-local 跨 batch replay window。

```
chain_mac_i = HMAC-SHA-256(
  gateway_key,
  frame32(
    previous_chain_mac,
    packet_header,
    ciphertext,
    aead_tag,
    received_at,
    gateway_id
  )
)

其中 `frame32(...)` 代表 canonical length-framed encoding，而不是把字串或位元組片段直接相鄰串接。
```

用途：
- 證明 gateway 接收後資料未被竄改
- 支援多單位（鄉公所 / 縣府 / 中央）比對
- replay 與 duplicate 偵測（需 production gateway 保存 counter / timestamp window）

`chain_mac` **不**取代封包內的 AEAD tag；前者保護 envelope（gateway 視角），後者保護 plaintext（device 視角）。

### 8.0.1 Analysis-component verification mode

`/api/packets` 與 `/api/packets/export` 接收的是 decoded packet JSON，不含原始 ciphertext / AEAD tag。為了讓離線 demo 與政府審查仍可驗證 gateway 邊界，analysis-component 在 production gateway verification mode 使用同一個 HMAC-SHA-256 chain 演算法，但 payload 固定為 canonical packet JSON，`aead_tag` 固定為 4 bytes zero。此模式驗證「decoded JSON 是由持有 gateway key 的 server-side gateway 送入」，不取代接收真實 LoRa frame 時對 ciphertext + AEAD tag 的 gateway 驗證。

Analysis-component 啟動時依下表決定 ingest 行為。預設 **fail-closed**：未配置 gateway key 且未顯式 opt-in demo 時，HTTP ingress 直接 503，**不得**靜默接受 unverified packet。

| `DOVETAIL_GATEWAY_MAC_KEY_HEX` | `DOVETAIL_ALLOW_UNVERIFIED_INGEST` | 行為 | 200 回應 `verification_mode` |
|---|---|---|---|
| 設定 (32 hex chars) | 任意 | 驗證 `chain_mac` + 跨 batch replay | `"verified"` |
| 未設定 | `1` | 跳過驗證（demo / dev 模式） | `"demo_unverified"` |
| 未設定 | 未設定或非 `1` | `503 gateway_verification_not_configured` | — |

關鍵契約：

- 當 `DOVETAIL_DEPLOYMENT_MODE=production` 時，`DOVETAIL_ALLOW_UNVERIFIED_INGEST=1` 一律回 `503 demo_unverified_not_allowed_in_production`；production 不得以 demo bypass 接收或匯出封包。
- `verification_mode` 為 `/api/packets` 與 `/api/packets/export` 200 回應的頂層字串欄位，enum 嚴格區分 `"verified"` 與 `"demo_unverified"`；同時以 `X-Dovetail-Verification-Mode` response header 對外輸出，作為 CSV / 檔案下載路徑的 audit carrier。
- `semantic_verification` 為 `/api/packets` 與 `/api/packets/export` 200 回應的頂層字串欄位，目前固定 `"field_observation_unverified_truth"`，明確標示「封包內容是現場觀察，不是事件真實性的證明」。
- `chain_mac` mismatch 時整批回 `400 invalid_chain_mac`，不得進入 aggregate / export。
- timestamp / replay rejection 必須先於任何 stateful gateway mutation 發生；也就是說，先做 replay / timestamp 分類，再決定是否讓 gateway state 前進。跨 batch replay key 已出現時整批回 `409 replay_detected`，不得進入 aggregate / export。
- production gateway verification mode 在單一 process 內必須序列化 state load → verify → save，避免兩個同時請求都在舊 replay / chain state 上通過。此序列化只涵蓋本 process，不取代跨 instance shared store。
- replay / chain state 為單 process 記憶體；水平部署仍需 production gateway 或 shared store 保存跨 instance window。
- `DOVETAIL_GATEWAY_VERIFICATION_STATE_PATH` 可在 Bun runtime 啟用 server-side file-backed state，保存 decoded JSON replay key seen-set 與 per-gateway last chain head，使 production gateway verification mode 可跨 process restart 保留 JSON replay / chain continuity。此檔案不保存 §3 AEAD nonce tuple，且不是 multi-writer distributed lock；多 instance 仍需 Redis / SQLite WAL / agency KV 等真正 shared store。檔案讀寫失敗時，HTTP ingress 必須 fail closed 為 `500 gateway_verification_error`。
- `DOVETAIL_REQUIRE_GATEWAY_VERIFICATION` 已**棄用**：「require」現為預設行為。0.5 起 src/ 不再讀取此 flag，文件保留歷史說明僅供 migration。
- Demo console 呼叫 `/api/packets` 失敗時，必須在 raw JSON 區顯示 `{ "error": "send_error", ... }`，並以接收端警示呈現 HTTP 錯誤；不得讓事件佇列、群組明細、彙總摘要維持無聲空白。
- Demo scenario 必須標示為 synthetic report，且不得以可回推個人的點位重建公開事件。若 demo 使用真實地理座標，必須標示為 public reference coordinates，不得稱為 mock；座標不得為了公開展示而任意降精度，避免 rounding 漂移到不相關私人地點。人員需求只做 aggregate-safe 呈現。
- Demo 顯示層可用 `Asia/Taipei` 本地格式；所有可機器讀取、稽核、排序或匯出的時間欄位仍必須為 Unix epoch 或 UTC `Z`。例如畫面可顯示 `2025/09/23 14:50`，對應 `<time datetime="2025-09-23T06:50:00Z">`。

## 8.1 接收端拒收契約 (Rejection contract)

`/api/packets` 為 analysis-component HTTP 邊界。接收端必須在分析前套用下列拒收規則，避免偽造、重放與資源耗用攻擊污染聚合輸出。所有規則均為 deterministic pure check，可於離線環境驗證。

### 8.1.1 Replay 拒收

- Gateway / codec 層必須先維護 **AEAD nonce replay store**，key 為 `device_mac || packet_type || packet_counter` 的邏輯 tuple，用來拒絕同一 device key 下重用相同 AEAD nonce 的 frame。這個 store 屬於 ciphertext 解密前後的 gateway 防重放責任，必須覆蓋韌體允許的 counter scope；若 counter 採 per-type 狀態，tuple 內必須包含 packet type。
- JSON 層 dedupe key 定義：`replay_key = sha256(packet_type || mac || ts_le)`，輸出為 64 hex chars；`packet_type` 為 §3 type byte，`mac` 為 6 bytes device MAC，`ts_le` 為 u32 little-endian seconds。此 key **不**同於 §3 的 AEAD nonce（後者為 `device_mac || packet_counter || packet_type || reserved`，12 bytes），且 `rejected[]` 不回吐 raw device MAC。AEAD 完整性已於 codec 解密時驗證；本層僅做 JSON 介面的 order-preserving 唯一性檢查。
- 接收端在 batch 內維護 `seen_replay_keys: Set<hex>`，遇重複 replay_key 一律拒收後續出現者。
- 時戳窗 `WINDOW_SECONDS = 300`：若 `|envelope.received_at - packet.ts| > WINDOW_SECONDS` 則拒收。以 `received_at` 為基準（gateway 視角），使 replay 判定屬資料本身性質，與 analysis-component 執行時鐘解耦。
- 拒收項以 `rejected: { index, replay_key, reason }[]` 列回，**不**中止整批；其餘合法封包仍進入 aggregate。
- 跨 batch JSON replay key seen-set 在 production gateway verification mode 由 analysis-component process-local 狀態承接；水平部署或長期保存仍屬 production gateway / shared store 責任。shared store TTL 必須至少覆蓋 ±300s timestamp window、最大預期 clock skew / delivery delay，以及 process restart overlap；`envelope.received_at` 對 wall-clock 的 freshness 檢查（防止遠古 batch 被重送）亦屬 gateway 責任，MVP analysis-component **不**做此檢查以保持時鐘無關性。
- `reason` 列舉：`duplicate_replay_key`、`timestamp_out_of_window`。

### 8.1.2 Envelope 偽造拒收

- `envelope.chain_mac` 必須符合 `^[0-9a-fA-F]{64}$`（HMAC-SHA-256 hex，32 bytes）。Loose-shape MAC（非 64 hex chars）視為偽造或破損 envelope，整批回 `400 invalid_packet_schema`。
- AEAD plaintext 偽造由 codec 層 AEAD tag 驗證承接（`/api/codec/decode` 於 tag fail 回 400）。
- Gateway key 不在本 repo 配發；production gateway verification mode 只從 server-side runtime config / private env 讀取 key，絕不可序列化到 client-side demo assets、OpenAPI examples 或 AI agent sessions。

### 8.1.3 Ingress 資源限制

| 限制 | 值 | 失敗回應 |
|---|---|---|
| Content-Type | `application/json` | `415 unsupported_media_type` |
| Body size | `MAX_PACKET_BODY_BYTES = 65536` (64 KiB) | `400 body_too_large` |
| Batch length | `MAX_PACKET_BATCH = 200` | `400 batch_too_large` |
| Rate limit | `RATE_LIMIT_PER_MIN = 60` / source / 60s 滑動窗 | `429 rate_limited` |
| Gateway verification unconfigured | missing key 且 `DOVETAIL_ALLOW_UNVERIFIED_INGEST` ≠ `1` | `503 gateway_verification_not_configured` |
| Demo verification in production | `DOVETAIL_DEPLOYMENT_MODE=production` 且 `DOVETAIL_ALLOW_UNVERIFIED_INGEST=1` | `503 demo_unverified_not_allowed_in_production` |
| Cross-batch replay | replay key already accepted by gateway verification state | `409 replay_detected` |

Source 識別策略：

- **預設**：所有來源共用 `"unknown"` bucket（避免攻擊者每 request 換 `x-source-id` 取得無限額度）。
- **信任反向代理時**（`DOVETAIL_TRUST_PROXY_HEADERS=1`）：優先序 `x-source-id` → `x-forwarded-for` 首段 → `"unknown"`。前置 proxy 必須剝除/正規化此兩 header，否則此選項毫無價值。

Rate limit 為單 process 記憶體 token bucket；正式部署可由前端 reverse proxy 取代。其他 endpoint（`/api/hazard-zone`, `/api/codec/*`, `/api/scenarios`, `/api/openapi.json`, `/api/docs`）不在本層 rate limit 範圍，由 host-level 或 reverse proxy 限速。所有 endpoint 之 schema 由 `/api/openapi.json`（OpenAPI 3.1 JSON）對外發佈；`/api/docs` 以本機託管的 Scalar single-HTML reference 讀取同一份 JSON contract，demo runtime 不依賴外部 CDN。

## 9. AI 使用邊界

本表把每個 AI 介入點映射到「政策意圖 → 工程交付 → 驗收基準」三欄。

| # | 用戶語言（政策／問題層） | 技術交付（工程層） | 驗收基準／現況 |
|---|---|---|---|
| 1 | 「封包編碼會不會被 AI 改寫、變成事後無法審？」 | call-component（封包 codec）全 deterministic：AEAD + chain MAC + 固定 enum；編解碼路徑無 LLM 介入 | `bun test` 中 `codec`、`chain-mac`、`replay` 等 suite 全綠；任何規格變更需重跑通過 |
| 2 | 「通報設備能不能離線、低功耗、即時送出？」 | 通報節點純規則式韌體；不載入模型、不依賴雲端推論；裝置端僅做 enum／threshold 判斷 | 通報→送出受限於 LoRa duty cycle，不受網路或雲端推論延遲影響；無網路、無 cloud token 仍可完成通報 |
| 3 | 「可不可以用 AI 預測哪裡會出事、自動發撤離？」 | 不導入風險預測模型、不導入撤離決策模型；撤離指令屬政府職權，protocol 邊界拒絕產出 | 無 `/predict`、無 `/dispatch` endpoint；對齊 §10「明確不做的事」 |
| 4 | 「開發過程用 AI 寫 code，怎麼證明 runtime 沒夾帶 AI 推論？」 | 開發階段允許 AI 協助 codegen；runtime binary 不引入 LLM SDK、不發遠端 inference call；codec 與 analysis rule 行為由本地測試 suite 鎖定 | `make verify`（lint + pre-push test suite）全綠；`package.json` 相依清單可審，無 LLM SDK 條目 |

人工最終裁量原則：rule-based deterministic 結果為事實稽核依據，任何輔助文字皆為 advisory；本協議不產出撤離、派遣、路線或預測決策。

## 9.1 雙層分離（通報行為 vs 被通報內容）

對應較少近用政府服務人群的設計平衡。

| 層 | 主體 | 屬性 |
|---|---|---|
| 通報行為層 | 通報者 / 通報設備 | 完整稽核軌跡, MAC 綁定, chain MAC, 政府可追溯 |
| 被通報內容層 | 撤離對象 | 僅座標 + 狀態 + flags, 不含姓名身分證, 對方可拒絕 |

**多語言知情同意（外接操作介面）**：通報前顯示多語言確認訊息；地方可擴充族語或客語。

- 按 ✓ → 通報送出, flag `consent_acknowledged = 1`
- 按 ✗ → status 維持 `unknown`, flag `consent_refused = 1`
- 無回應（30 秒 timeout）→ 同 ✗

語言預設清單由外接介面、companion 裝置或 device profile 預載, 不入封包（節省 byte）。「同意 / 拒絕」動作本身只作為操作紀錄；它不能單獨證明一定是本人親手按鍵。族語或外語翻譯屬地方化字串表，協議只提供承載與記錄機制，不自行驗證翻譯正確性。

## 10. 明確不做的事

本協議明確排除：

- ✗ 撤離決策、路徑建議或風險預測（屬政府職權）
- ✗ 不做處置建議或處置優先序
- ✗ 語意分析（救災需要可預測性）
- ✗ AI 推論的最終決策（高風險領域）
- ✗ 民眾介面（在地節點比 App 用戶可靠）
- ✗ 直接對接政府系統（合規與責任邊界考量）

## 11. 互通接點：接收端提示標籤 / OSM

Packet 仍只承載村里幹事 / 部落協力者 / 民防在離線或網路不穩時可回報的事實觀察。

Analysis export 在 JSON 層提供兩個保守互通欄位：

| 欄位 | 出現位置 | 用途 |
|---|---|---|
| `receiver_tags` | `agency-export` 的 `needs_flags`、`resource_requests` rows | 讓接收端可把聚合需求列對到本地 spreadsheet / ETL 類別 |
| `osm_tags_proposed` | `agency-export` 的 `terrain_event:*` queue rows；`/api/packets` overlay 中的 terrain observations | 給 GIS / OSM 資料工作者審查的 proposed `key=value` hints |
| `lat` / `lng` / `coord_resolution` | `agency-export` 的 JSON `event_queue` rows | 只輸出 rounded centroid，預設 `coord_resolution=2`；HTTP query 僅允許 `0..4`，不提供 raw 高精度 agency export |

`receiver_tags` 的詞彙參照 HXL 的「用簡短 hashtag 提示 spreadsheet 欄位語意」概念，但本 repo 不直接照搬 HXL。理由是 packet 本體必須維持低頻寬、固定 enum、可本地化與可最小揭露；完整 HXL 比較適合人道資料交換表格，不適合作為 LoRa packet spine，也不適合把敏感身分 proxy 直接標籤化。

這些欄位只存在 JSON 輸出。CSV export 保留既有 header：

```csv
profile,section,area,cluster_id,kind,status,count,max_severity,latest_ts
```

Export profiles 是資料切片，不是權限系統。部署者可用 `DOVETAIL_EXPORT_PROFILES=partner,township` 設定可使用的 profile；未列入時回 `403 export_profile_not_allowed`。當 `DOVETAIL_DEPLOYMENT_MODE=production` 且未設定 `DOVETAIL_EXPORT_PROFILES`，`/api/packets/export` 回 `503 export_profile_allowlist_not_configured`。`partner` 吸收「民間自主緊急應變隊」（T-CERT）等外部協力組織。

`needs_flags` export 對敏感 proxy flags 做泛化：`migrant_worker`、`foreign_visitor` 併為 `language_or_nonlocal_support`；`long_term_care`、`special_needs`、`requires_separated_space` 等併為 restricted support row，且小量計數以 `<5` bucket 顯示。其他身分 / 位置狀態 proxy 預設不進入 agency export。接收端提示標籤僅保留明確急難狀態如 `trapped`；身分或照護 proxy 不輸出具名標籤。

### 11.1 CSV opt-in metadata 行

預設 `format=csv` 回應的 byte 內容（含 UTF-8 BOM 與上述 header）**不變**，既有 spreadsheet 工作流不受影響。

機關間透過離線檔案（email / 雲端硬碟）傳遞 CSV 時，加 query `include_metadata=1` 可在第一行前置 audit 訊號：

```
# verification_mode=verified,semantic_verification=field_observation_unverified_truth,exported_at=2026-05-23T08:12:09Z
profile,section,area,cluster_id,kind,status,count,max_severity,latest_ts
...
```

- 行首 `#` 為 pandas (`comment="#"`)、DuckDB (`read_csv(..., comment='#')`)、awk (`/^#/{next}`) 通用 comment skip prefix；未啟用 comment skip 的 parser 將首行視為單欄資料列，呼叫方須在文件中宣告使用此 opt-in。
- `verification_mode` 值與 JSON body / `X-Dovetail-Verification-Mode` header 同一 enum，稽核 log 可跨 format 比對。
- `semantic_verification` 值與 JSON body 同步，避免 UI / JSON / CSV 在語意風險標示上漂移。
- `exported_at` 為 RFC 3339 UTC，標示產出時刻；不取代 packet `ts`。
- 此 metadata 行不含 PII，僅 ingest 階段事實。

### 11.2 Data governance drift gate

效能修繕進場前，`make verify-contract` 必須先通過資料治理 drift gate。此 gate 不只跑型別與 OpenAPI，也固定 canonical lineage fixture：raw packet input order、accepted / rejected 分流、`rejected[].index/reason/replay_key` 順序、`summary`、`overlays[].index`、`alerts[].refs`、`event_queue.groups[].clusters[].id`、`cluster.packetIndexes`、agency export JSON rows、CSV BOM / header / metadata comment / row order、`verification_mode` body / header，以及 chain MAC 成功與失敗時的 gateway state 變化。

變更規則：

- packet enum 改動時，必須同步 `src/packet/types.ts`、本 spec、`src/openapi.ts`、fixture / demo scenarios，並重新跑 contract gate。
- export 欄位改動時，必須同步 public integration guide、CSV tests、agency export tests。
- alert refs、overlay index、event queue lineage、cluster id 或 `packetIndexes` 改動時，必須同步 data-lineage tests，且說明是否為刻意 contract 變更。
- demo scenario 改動時，必須重新驗證 scenario JSON 與 analysis output，避免 demo 展示和治理 fixture 漂移。
- `verifyGatewayBatch()`、`chain_mac`、gateway replay state、`verification_mode` body / header / CSV metadata 不得和一般效能修繕混在同一 PR，除非修繕目標就是 gateway verification。

明確排除：

- CAP：本元件不是公眾警報發布。
- EDXL-HAVE / EDXL-TEP：醫院床位與病患追蹤不在範圍。
- EDXL-DE：MVP 不採 XML routing wrapper；gateway audit 以 `chain_mac` 承接。
- GeoThings ontology root metadata：`event_id`、官方 incident lifecycle、verified/resolved 狀態由接收機關管理。
- `damage_level` / `incident_type` alias：`terrain_event.severity` 是通行 / 撤離可行性觀察，不是災損等級。

參考來源： https://github.com/GeoThings/disaster-ontology/

## 12. Accessibility（demo 介面對齊條款）

Demo 介面只服務「在地節點 / 機關接收端」操作者，假設視覺通道可能受色覺異常（red-green 為大宗）或低對比顯示器影響。本節為 demo console 設下硬性編碼要求，並適用於任何沿用本協議圖層命名（`hazard-zone.*`、`map-point.*`）的後續實作。

### 12.1 雙重編碼（dual encoding）

所有 hazard layer 資訊必須以**色相 + 紋理 + 形狀**至少兩種以上同時編碼，不得單靠色相區分：

| 資料層 | 主編碼 | 副編碼 |
|---|---|---|
| `hazard-zone.river-corridor` | Okabe-Ito blue | SVG dot pattern |
| `hazard-zone.landslide` | Okabe-Ito vermillion | SVG diagonal hatch |
| `hazard-zone`（其他預設） | Okabe-Ito orange | SVG crosshatch |
| `map-point`（預設 person_report） | Okabe-Ito slate | 實心圓 |
| `map-point.terrain-event` | Okabe-Ito reddish-purple | 三角形 |
| `map-point.in-zone` | Okabe-Ito bluish-green | 雙環（ring + dot）|

「主編碼」即使遭 deuteranopia / protanopia / tritanopia 模擬轉換後失去區分，「副編碼」仍須可識別。`hazard-zone` 必含 `<title>` 文字描述供螢幕閱讀器 / hover tooltip。

### 12.2 調色盤約束

Demo 採 Okabe-Ito 8 色色盲安全色盤的子集；任何替換需通過 deuteranopia / protanopia / tritanopia 三項模擬下仍能與其他 hazard token 區分的目視檢查。

`--orange` / `--rose` / `--slate-dark` 等 CTA token 與 `apca.ts` 的 APCA Lc70 audit 綁定，不在本節色盤替換範圍。

### 12.3 圖例（legend）對齊

`.hazard-legend` 的 swatch 必須與地圖實際 SVG 樣本同步（同色 + 同 pattern + 同形狀）。純色方塊 swatch 不符本條款。圖例文字需可獨立讀取（不依賴 swatch 色相理解語意）。

### 12.4 動態 / 焦點

`prefers-reduced-motion` 已生效。新增動畫 / 過場若涉及 hazard layer 切換，須遵循同 reduce-motion gate。互動元素（hazard toggle、opacity slider）保留鍵盤可達與 `:focus-visible` outline。

## 13. 版本

| 版本 | 日期 | 變更 |
|---|---|---|
| 0.1 | 2026-05-15 | 初版規約 |
| 0.2 | 2026-05-17 | JSON export 增加接收端提示標籤與 proposed OSM 互通欄位；CSV contract 不變 |
| 0.3 | 2026-05-21 | 新增 §8.1 接收端拒收契約：replay window、envelope chain_mac shape lock、ingress rate limit |
| 0.4 | 2026-05-23 | 新增 §12 Accessibility：hazard layer 雙重編碼（色相 + pattern + shape）、Okabe-Ito 色盤、legend 對齊條款 |
| 0.5 | 2026-05-23 | §8.0.1 改 fail-closed 預設：未配置 gateway key 且未 `DOVETAIL_ALLOW_UNVERIFIED_INGEST=1` → 503；回應新增 `verification_mode` 欄位與 `X-Dovetail-Verification-Mode` header；棄用 `DOVETAIL_REQUIRE_GATEWAY_VERIFICATION`；§11.1 新增 CSV opt-in metadata 行（`include_metadata=1`）以承載跨機關離線檔案 audit 訊號 |
| 0.6 | 2026-05-30 | §11 agency-export JSON event queue row 新增 rounded `lat` / `lng` / `coord_resolution`；HTTP query 僅允許 `coord_resolution=0..4`，預設 4 位小數；CSV header 不變 |
| 0.7 | 2026-05-30 | privacy-by-default export：預設 `coord_resolution=2`、production 禁用 demo unverified ingest、production export 必須設定 `DOVETAIL_EXPORT_PROFILES`、移除外部協力獨立 profile，敏感 proxy flags 在 export 層泛化與小量 bucket |
| 0.8 | 2026-05-30 | §7.1 明確定義 event queue `severity` / `maxSeverity` 為顯示排序權重，不是風險評估、派遣建議或處置優先序 |
| 0.9 | 2026-05-31 | §3 nonce reserved byte 明確綁定 packet type，允許 per-(device_mac, packet_type) counter 而不重用同一 AEAD nonce |
| 1.0 | 2026-05-31 | §3 明確標示 32-bit AEAD tag 為 constrained profile，並記錄 ChaCha20-Poly1305 只能作未來獨立 profile |
| 1.1 | 2026-05-31 | §8 將 gateway key rotation 視為 production governance；§8.1 明確區分 AEAD nonce replay store、JSON replay key 與可選 file-backed gateway verification state |

問題定義：在低頻寬或離線環境中，現場節點最低限度應送出結構化事實，使政府接收端、民防與協力組織能延續既有流程；由政府決策。
