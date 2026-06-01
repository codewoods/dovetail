# 燕尾榫（@codewoods/dovetail）

> Emergency reporting components for low-bandwidth field reports and local geospatial analysis.

TL;DR: 低頻寬 / 離線現場通報 -> 結構化 JSON/API -> 聚合、疊合、匯出。

> [!NOTE]
> 數發部 2026 公民科技「[防災積木元件創新賽][modatw-civictech2026-url]」參賽作品。
> Demo 情境取材自 2025 年 9 月花蓮馬太鞍溪堰塞湖事件，僅作為公開可參照的災情背景，不重建任何真實個案。
> Demo 與測試資料**不識別、定位、描述**任何真實個人、家戶或案件；完整聲明見下方 [Demo and Test Data Boundary](#demo-and-test-data-boundary)。

## Start Here

- [SPEC](SPEC.md): 協議本文、元件、API 與安全邊界。
- [PERSONA](PERSONA.md): 使用者、被通報者、接收端與協力角色。
- [LIMITATIONS](LIMITATIONS.md): MVP 與 production deployment 的已知限制。

其他入口：

- 與外部整合：`docs/public/integration-guide.md`, `docs/public/security-assurance.md`
- 協議本文與 API contract：`SPEC.md`, `src/openapi.ts`
- 開發復現與 API 範例：`docs/developer/reproduce.md`, `docs/developer/client-sample.md`, `docs/developer/security-test-plan.md`
- 維護與 fork：`docs/maintainer/non-engineer-guide.md`, `docs/maintainer/journey-test-matrix.md`, `docs/maintainer/agency-data-dictionary.md`

## 問題情境

即使微波系統與中軌、低軌衛星通訊相互整合，災時通訊仍然可能壅塞，而且不一定能納入地方日常演練。

本作品探索一個更小的問題：在低頻寬或離線環境中，現場節點最低限度應該能送出哪些結構化事實，讓政府接收端、民防與協力組織可以繼續接到既有流程。

背景例子：

- 2024 年山陀兒颱風期間，中央社報導中央與花蓮縣政府對撤離保全戶數的呈報與盤點口徑出現落差。這類「名冊 / 戶籍 / 現場實際人數」落差，是政府端 reconciliation（多來源對帳）本身的工作；本協議因此只通報現場觀察事實。[來源][cna-protected-household-dispute]
- 非設籍人員、臨時駐點工作者不一定會被納入既有撤離名冊或細胞廣播觸達範圍；他們需要的是被結構化通報「看見」，而不是另寫一套個案資料庫。

## What This Is

本 repo 提供兩個可分開採用的元件：

| 元件 | 型態 | 功能 |
|---|---|---|
| `call-component` | Library / Package | `src/packet/` 三種封包型別、addr 字典、AES-128-GCM host codec、JSON validation |
| `analysis-component` | API Service | `src/analysis/` 聚合統計、危險區疊合、事實觸發、gateway chain MAC helper |

兩元件透過 decoded packet JSON 對接。整合端可以只採用封包 vocabulary，也可以使用本 repo 的 Bun local demo API。

### 架構與資料流

```text
通報節點 (村里幹事 / 部落協力 / 民防 / 避難所工作人員)
   │
   │ 觀察事實 → 三種低頻寬封包
   ▼
┌───── call-component (Library, src/packet/) ─────────┐
│  0x01 person_report    40 bytes  人員狀態通報         │
│  0x02 terrain_event    29 bytes  地形 / 事件通報      │
│  0x03 resource_report  36 bytes  資源請求 / 提供      │
│                                                      │
│  AES-128-GCM AEAD · addr 字典 · Valibot validation   │
└────────────────────────┬─────────────────────────────┘
                         │
        傳輸層 (任選)：   │ packet JSON + envelope.chain_mac
        LoRa / 衛星窄頻   │ (共用同一份 plaintext schema)
        HTTPS / CSV import│
                         ▼
┌──── analysis-component (API Service, src/analysis/) ─┐
│  Ingress guard                                       │
│    replay reject · chain_mac verify · rate limit     │
│    body / batch / content-type cap                   │
│                                                      │
│  Pipeline (deterministic, pure transform)            │
│    aggregate → hazard overlay → fact alerts          │
│    → event queue clustering → agency export          │
│                                                      │
│  HTTP endpoints                                      │
│    POST /api/packets         聚合 / overlay / alerts │
│    POST /api/packets/export  8 個 agency profile     │
│    GET  /api/hazard-zone     靜態危險區查詢          │
│    GET  /api/openapi.json    OpenAPI 3.1 contract    │
│    GET  /api/docs            本機 Scalar reference   │
└────────────────────────┬─────────────────────────────┘
                         │ 角色切片 (最小揭露)
                         ▼
接收端 (依 export profile)：
   township · county · central     政府應變層
   rescue   · social  · healthcare 救援 / 社工 / 醫療
   partner  · lifeline             民間救助 / 維生基礎設施
```

完整 byte layout、enum 與 HTTP contract 見 `SPEC.md` 與 `src/openapi.ts`。

## What This Is Not

本協議**是**結構化通報的封包規格與聚合介面：定義通報該長什麼樣、提供聚合、疊合與匯出。

本協議**不是**指揮、監控、路線規劃、預測或個案管理平台。不做：

- 撤離命令
- 派遣建議
- 路線建議
- 災害發展預測
- 身分識別
- 戶籍、長照名冊或個案資料庫同步

Production 的存取控制、資料留存、授權查詢、法規合規、key lifecycle、operator authentication 與政府內部 reconciliation，由整合端依既有權責承接。

## Input / Function / Output

| 面向 | 本 repo 對應 |
|---|---|
| Input | `examples/packets-batch.json` 的 decoded packet JSON，或 demo 內建 scenarios |
| Function | `call-component` 做三種低頻寬封包定義、JSON validation、AES-128-GCM host codec；`analysis-component` 做聚合、hazard overlay、facts / alerts、agency export hints |
| Output | `/api/packets`, `/api/hazard-zone`, `/api/openapi.json`, `/api/docs`, agency export JSON / CSV |

## Packet Model

| Type | 名稱 | Size | 用途 |
|---|---|---|---|
| `0x01` | `person_report` | 40 bytes | 人員狀態、數量、位置、flags |
| `0x02` | `terrain_event` | 29 bytes | 土石流、淹水、道路阻斷、排水回堵等現場事件 |
| `0x03` | `resource_report` | 36 bytes | 資源請求或提供 |

封包只承載「災時現場事實」的群體 / 狀態通報，不承載戶籍、親屬稱謂、姓名、證件、電話或可讀門牌。完整 byte layout、欄位列舉、JSON Schema 見 `SPEC.md`。

### 複合家戶與臨時人流

例如隔代教養、長照照護、非設籍工作者、外國旅客與臨時依親情境，不用戶籍或親屬稱謂描述。通報端只回報「實際所在村里 + 座標 + 當下狀態 + 人數 + flags」。

例如家中成員臨時在隔壁村，就用隔壁村的村里代碼與現場座標通報；留在原址的家戶與在場協力者，則用原址所在村里與現場座標通報。若同行者或同址人員具有不同支援需求或敏感 proxy flag，應拆成另一筆 `person_report`，避免 `special_needs` 等 flags 套用到整筆 `count`。

避難支援需求統一用 `special_needs` 表示，不在封包內拆成更細身分類別。臨時人流可由巡守隊、里辦或收容點作為臨時人流通報，不需要放進家庭關係敘事。需要具體資源時，再另送 `resource_report`，例如 `medical_aid`、`shelter_space`、`food_water` 或 `warmth_supplies`。

### Coverage Boundary

封包模型刻意保持小而急難導向：

- `person_report` 回答「有多少人、在哪、現在狀態如何」。
- `terrain_event` 回答「現場可觀察的災況或通行條件是什麼」。
- `resource_report` 回答「現場需要什麼或可提供什麼」。

照護名冊、用藥、輔具、戶籍與持續個案管理，留在地方 SOP 或授權接收系統中，不變成 packet enum。

## Demo and Test Data Boundary

Demo scenarios, test fixtures, packet coordinates, status labels, resource needs, and persona descriptions in this repository are for simulation and contract testing only. They do not identify, describe, locate, or assert the condition of any real person, household, group, or case.

Any coordinates used by demo packets or tests are either public-reference coordinates or synthetic unit-test coordinates. When coordinates refer to real geography, the report content is synthetic but the coordinate itself is not described as mock. These points are not a reconstruction of a real incident, household, route, sheltering decision, or welfare case.

Some demo coordinates are kept at fixed decimal precision so deterministic tests hit the intended public reference coordinate and do not drift to unrelated private locations through rounding. This precision is a testing constraint, not a claim about a real household, shelter occupancy, resource need, or field observation.

Official open-data geometry is used only as a static overlay source for demonstrating deterministic analysis. Raw geospatial files, address fields, coordinate review notes, and source-processing working files are not published in this repository.

本 repo 的 demo scenarios、test fixtures、封包座標、狀態標籤、資源需求與 persona 敘述，僅用於模擬與 contract testing。這些資料不識別、描述、定位或主張任何真實個人、家戶、群體或案件狀態。

Demo 或測試封包中的座標分為 public-reference coordinates 或純合成 unit-test coordinates。若座標對應真實地理空間，通報內容是 synthetic，但座標本身不稱為 mock。這些點位不是現實事件、住戶位置、移動路線、避難或安置決策、社福 / 醫療個案的重建。

部分 demo 座標保留固定小數精度，是為了讓 deterministic tests 命中預期的 public reference coordinate，避免四捨五入後漂移到不相關的私人地點。這種精度是測試約束，不代表真實家戶、收容人數、資源需求或現場觀察。

上述聲明包含但不限於姓名、身分證字號、戶籍、門牌、聯絡方式、精確可識別位置、家庭關係、照護狀態、國籍 / 移民身分、健康狀態、受暴或安全需求、宗教 / 族群 / 語言等可能直接或間接識別個人或弱勢群體的資訊。

官方開放圖資只作為靜態 overlay 來源，用於示範 deterministic analysis。

## Analysis and Security Boundaries

`analysis-component` 只呈現事實、統計與 deterministic hints。`event_queue.severity` / `maxSeverity` 是接收端檢視排序權重，不是危險分數、派遣優先序，也不是政府感測讀數。

MVP host / demo codec 採 Web Crypto AES-128-GCM；相容硬體 device profile 保留 AES-128-CCM 選項，兩者共用 plaintext schema。Gateway `chain_mac` 是 append-only 稽核 / 對帳訊號，不取代 packet AEAD tag。目前 32-bit AEAD tag 為低頻寬 constrained profile，不是 general-purpose high-assurance network profile；production 若頻寬允許，應評估 64-bit 以上 tag。

正式部署仍由整合端承擔：per-device key provisioning、key rotation 與 revocation、secure key storage、shared replay state、immutable audit log、gateway / operator authentication、access control 與資料留存政策。

## Quick Start

```sh
bun install
make verify

# Demo / 評審復現模式 (放寬 HMAC gateway 驗證，方便快速啟動)
DOVETAIL_ALLOW_UNVERIFIED_INGEST=1 make dev

# 完整驗證模式 (需先設定 DOVETAIL_GATEWAY_MAC_KEY_HEX)
make dev
```

Analysis-component 預設 fail-closed：未設定 server-side gateway MAC key 且未顯式 opt-in `DOVETAIL_ALLOW_UNVERIFIED_INGEST=1` 時，`/api/packets` 回 `503 gateway_verification_not_configured`，正式部署不應使用 demo flag。詳見 `docs/developer/reproduce.md`、`docs/developer/security-test-plan.md` 與 `SPEC.md` §8.0.1。

預設綁 `9000`；若被占用，Bun 自動往上掃 9001-9009 並把實際 URL 印到 console。也可顯式指定 `PORT=9010 ... make dev`。

## API Examples

列出 demo scenarios：

```sh
curl http://localhost:9000/api/scenarios
```

批次送 packet 取得聚合分析：

```sh
curl -X POST http://localhost:9000/api/packets \
  -H 'content-type: application/json' \
  --data-binary @examples/packets-batch.json
```

靜態危險區查詢：

```sh
curl 'http://localhost:9000/api/hazard-zone?lat=23.661234&lng=121.421789'
```

OpenAPI 3.1 JSON contract：

```sh
curl http://localhost:9000/api/openapi.json
```

Scalar API reference：

```sh
curl http://localhost:9000/api/docs
```

## Competition Checklist

對應簡章 §五（評分項）與 §七(二)（應備文件 9 項）。

| 要求 | 對應位置 |
|---|---|
| 防災問題與 persona | 本 README, `PERSONA.md` |
| 可操作 MVP | `make verify`, `make dev`, `examples/packets-batch.json` |
| Input / Function / Output | 本 README, `SPEC.md`, `src/openapi.ts` |
| 元件化與可拼接性 | `src/packet/`, `src/analysis/`, `docs/public/integration-guide.md` |
| AI 使用與界線 | 本 README, `docs/public/security-assurance.md` |
| 安全與隱私界線 | `docs/public/security-assurance.md`, `docs/developer/security-test-plan.md`, `test/security-boundary.test.ts` |
| Client sample code（§七(二) 7） | `docs/developer/client-sample.md` |
| OpenAPI / Swagger 規格（§七(二) 9） | `GET /api/openapi.json`、`GET /api/docs`（本機 Scalar），契約源於 `src/openapi.ts` |
| GitHub 專案連結（§七(二) 1） | https://github.com/codewoods/dovetail |
| 開源可重現 | `docs/developer/reproduce.md`, `examples/packets-batch.json` |
## AI Use

開發過程使用生成式 AI 工具（Codex by OpenAI、Claude Code by Anthropic）協助規格討論、程式撰寫、測試與 code review。AI agent 被隔離在 Bubblewrap 沙盒環境內、不持有 production keys；責任邊界（包含威脅模型與風險矩陣）記錄於 `docs/public/security-assurance.md` 與 `docs/developer/security-test-plan.md`。

作品運行時不使用 AI 推論。`call-component` 將現場通報轉換為結構化資料；`analysis-component` 只展示通報資料如何被聚合、疊合與匯出，不提供風險預測、決策建議或身分識別。

下面表格把每個 AI 介入點映射到「政策意圖 → 工程交付 → 驗收基準」三欄。

| # | 用戶語言（政策／問題層） | 技術交付（工程層） | 驗收基準／現況 |
|---|---|---|---|
| 1 | 「封包編碼會不會被 AI 改寫、變成事後無法審？」 | call-component（封包 codec）全 deterministic：AEAD + chain MAC + 固定 enum；編解碼路徑無 LLM 介入 | `bun test` 中 `codec`、`chain-mac`、`replay` 等 suite 全綠；任何規格變更需重跑通過 |
| 2 | 「通報設備能不能離線、低功耗、即時送出？」 | 通報節點純規則式韌體；不載入模型、不依賴雲端推論；裝置端僅做 enum／threshold 判斷 | 通報→送出受限於 LoRa duty cycle，不受網路或雲端推論延遲影響；無網路、無 cloud token 仍可完成通報 |
| 3 | 「可不可以用 AI 預測哪裡會出事、自動發撤離？」 | 不導入風險預測模型、不導入撤離決策模型；撤離指令屬政府職權，protocol 邊界拒絕產出 | 無 `/predict`、無 `/dispatch` endpoint；對齊 §10「明確不做的事」 |
| 4 | 「開發過程用 AI 寫 code，怎麼證明 runtime 沒夾帶 AI 推論？」 | 開發階段允許 AI 協助 codegen；runtime binary 不引入 LLM SDK、不發遠端 inference call；codec 與 analysis rule 行為由本地測試 suite 鎖定 | `make verify`（lint + pre-push test suite）全綠；`package.json` 相依清單可審，無 LLM SDK 條目 |

人工最終裁量原則：rule-based deterministic 結果為事實稽核依據，任何輔助文字皆為 advisory；本作品不產出撤離、派遣、路線或預測決策。

### Agent Quick Context

Agent work should start from `AGENTS.md` and the root evaluator docs.

Use:

```sh
make verify
```

Fast checks:

```sh
make lint
make pre-push
```

Never run `git commit --no-verify`. If a hook fails, fix the reported issue and rerun the matching check.

## Runtime

- Node.js 22+
- Bun 1.3+（預設以 `Bun.serve` 本機啟動，符合 demo 環境「離網通報」情境）

## Tooling

- Runtime / package management: [mise](https://mise.jdx.dev/), Node, Bun, Python, uv, Go
- Type system / validation: [TypeScript](https://www.typescriptlang.org/), [Valibot](https://github.com/open-circle/valibot), [ts-pattern](https://www.npmjs.com/package/ts-pattern)
- Testing: [Vitest](https://vitest.dev/)
- Linting / docs checks: [Biome](https://biomejs.dev/), [OxLint](https://oxc.rs/docs/guide/usage/linter.html), Stylelint, ls-lint, [Vale](https://vale.sh/), [Knip](https://www.npmjs.com/package/knip)
- Git / CI hygiene: Lefthook, Gitleaks, commitlint, conventional commits
- Geospatial tooling: [GDAL](https://gdal.org/en/stable/programs/ogr2ogr.html), [jq](https://github.com/jqlang/jq)
- API docs: [Scalar](https://scalar.com/) vendored for offline `/api/docs`
- CSS: vanilla CSS with Okabe-Ito color-blind friendly palette

## Data Attribution

This demo includes simplified / redacted derived geometry from Taiwan open government data. Raw geospatial files, address fields, coordinate review notes, and source-processing working files are not published in this repository.

| Dataset | Publisher | Source | License / Legal basis |
|---|---|---|---|
| 115年度1753條土石流潛勢溪流影響範圍圖 | 農業部，via 政府資料開放平臺 | https://data.gov.tw/dataset/176526 | 政府資料開放授權條款-第1版 |
| 115年度94處大規模崩塌潛勢區影響範圍 | 農業部，via 政府資料開放平臺 | https://data.gov.tw/dataset/176528 | 政府資料開放授權條款-第1版 |

## Third-party Notices

- Scalar API Reference (`src/vendor/scalar-api-reference.js`) is vendored for offline API documentation. Scalar is licensed under the MIT License. Source: https://github.com/scalar/scalar
- The vendored Scalar bundle keeps its upstream header and embedded Tailwind CSS MIT notice.

## License

> [!CAUTION]
> 本作品有許多思考未及週延之處，實際使用前請務必謹慎考量（資安）風險。

Apache License 2.0. See [LICENSE](LICENSE) for more information.

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[cna-protected-household-dispute]: https://www.cna.com.tw/news/aipl/202410020113.aspx
[modatw-civictech2026-url]: https://civictech.moda.gov.tw/
