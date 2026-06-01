# PERSONA 摘要

本協議的直接使用者不是一般 App 使用者，而是在地通報節點與政府接收端。其他角色多半是「被通報的人」或「資源提供者」。

## 設計原則

- **紀錄現場訊號，不增加現場判斷。**
- 通報者紀錄看到與問到的事，不判斷安全、不查身分、不問特殊需求理由。
- 民眾不交姓名、身分證、電話、護照。
- Demo 與文件不得把 mock 點位寫成可回推真實住戶、個案或照護狀態的位置。
- 政府取得可比對資料，但撤離、派遣、安置仍由既有權責判斷。

## 六層角色

| 層 | 角色 | 協議關心的事 |
|---|---|---|
| 1 | 村里幹事、在地長者、巡守隊、避難收容處所管理員 | 用固定欄位快速通報 |
| 2 | 設籍居民與避難支援需求對象 | status、count、特殊後勤需求 |
| 3 | 非設籍人員、臨時駐點工作者 | 非設籍但需要被看見 |
| 4 | 車內避難者、臨時過客 | 沒有門牌也能通報 |
| 5 | 政府接收端（詳下表） | 消費結構化資料，不由協議下命令 |
| 6 | 資源提供與協力（詳下表） | 回報可提供或需要的資源 |

特定避難支援需求屬地方 SOP / 名冊治理，不是低頻寬封包的細分類。封包只承載急難狀態、粗粒度需求 flags 與資源訊號；demo 只能以 mock aggregate 表達，不標出個別脆弱身分。

## 八個 agency profile 角色

政府接收端（層 5）與資源提供者（層 6）細分為八個 export profile，每個 profile 只看到「該角色需要的資料切片」：

| Profile | 角色舉例 | 收到的資料範疇 |
|---|---|---|
| `township` | 鄉鎮市公所人員| 完整 event queue + alerts + summary |
| `county` | 縣市府災防中心、各局處應變代表 | event queue + review hints + alerts + summary |
| `central` | 中央災害應變中心、各部會代表 | 同 county |
| `rescue` | 警消第一線、山難搜救隊、民間搜救組織 | rescue clusters（`rescue_needed`、`trapped`、`unreachable`）+ review hints |
| `social` | 社工、語言志工、文化中介者 | grouped needs flags + 全品項 resource requests |
| `partner` | 慈濟、教會、當地 NGO、民間自主緊急應變隊(T-CERT)| resource requests + resource offers；不含個別住戶狀態 |
| `lifeline` | 台電、電信業者、公路總局、地方工務局 | 停電/訊號中斷/道路阻斷/橋梁坍塌 clusters + 電力/通訊資源 |
| `healthcare` | 衛生所、區域醫院、醫療物資調度單位 | 傷病 needs flags + medical_aid 資源請求 |

`social` 接收 `trapped` flag（人仍在現場，需要安撫），不接收 `rescue_needed` cluster（由 rescue 承接救援行動）。`partner` 看到資源請求與提供，不看個別住戶通報，以保護個資並符合民間組織的操作範疇。

## 語言與同意邊界

外接操作介面可顯示中、英、等不同語言字串；族語或其他方語屬地方化字串表。介面可由 e-ink、舊手機、平板、USB/BLE/Serial companion 或其他可近用裝置承接，不綁定單一開發板螢幕。

`consent_acknowledged` 與 `consent_refused` 是設備流程中的操作紀錄，不是完整法律證明，也不保證一定是本人親手按鍵。若由家屬、語言志工或在地協力者協助說明，脈絡應留在地方 SOP 或紙本紀錄，不塞進低頻寬封包。

## 落地阻力

協議降低通報門檻，但不取代信任建立。部份群體可能傾向避免接觸政府服務；本作品盡力降低參與代價，不是承諾匿名。

特殊安置需求只記錄當事人主動表達的需求，例如 `requires_separated_space`；通報者不問理由、不判斷安全、不貼標籤。後續安置、翻譯、社工與照護仍由地方制度承接。
