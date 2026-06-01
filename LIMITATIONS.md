# 已知限制

主動列出限制是本協議設計的一部分。這些限制不表示方向不可行，而是說明初選 MVP 與 production deployment 的邊界。

## 1. Mesh 覆蓋仍需場域測試

LoRa / Mesh 可作為最後一哩補位，但山區、溪谷、隧道、室內遮蔽情境需要實測制高點中繼、天線方向與節點密度。初選版本只實作封包與分析流程。

## 2. 基層採用不是即拿到即用

本協議依賴村里幹事、巡守隊、部落協力者或避難收容處所人員操作。落地必須接到既有撤離演練與地方 SOP，不能只靠發設備。

## 3. 衛星整合只預留封包相容性

40 / 29 / 36 bytes 封包適合低頻寬通道，但尚未實作 OneWeb、Starlink、AST 或其他衛星服務的實際 gateway。

## 4. 特定開發板實作不列入初選交付範圍

初選投稿準備期間，專案以 TypeScript codec、Bun API、Web demo 驗證協議邏輯，不把特定開發板 firmware、螢幕 flow 或按鍵 GPIO mapping 列為初選交付承諾。若通過初選，硬體驗證仍須依時間、效益與政府資通產品來源要求重新決定；通訊模組只需能依 device profile 產生同一份封包，因此協議保持硬體中立。

若現場設備沒有螢幕，或只採用通訊模組，也可外接 e-ink、舊手機、平板、USB/BLE/Serial companion 或無障礙輸入裝置作為操作介面。舊手機能使用系統內建的放大、螢幕閱讀器、語音輸入、切換控制等無障礙功能，讓多語與身心障礙使用情境由外接介面承接，而不是綁死在單一開發板。

## 6. 個資治理需制度承接

本協議降低自由文字解讀風險，並避免傳輸姓名、證件、電話。但村里幹事災害通報行為的 log 存取、身分比對權限仍需地方 SOP、政府資安規範與法規承接。

## 7. 翻譯品質不由協議認證

協議可承載地方化字串與記錄操作結果，但外語、族語翻譯需由地方政府、部落或可信語言協力者確認。

## 8. 雲端部署不在 MVP 範圍

協議本身為 runtime-agnostic fetch handler。初選 demo 以 `Bun.serve` 本機啟動，確保「離網通報」情境連 demo 動作都不依賴雲端基礎設施；評審現場無網路也可在 laptop 重現完整通報 → 分析 → 接收三畫面。正式環境的雲端 / 邊緣 / 容器部署策略由各整合單位依自身合規與營運判斷，本 repo 不預設目標平台。

## 9. severity 是現場觀察，非政府感測

`terrain_event.severity` 欄位由第 1 層 persona 觀察者（村里幹事 / 巡守隊 / 在地長者 / 避難收容處所管理員）到場時依「通行 / 撤離」可行性 4 級判斷（詳 `SPEC.md` §5.7），**不**取代氣象局雨量站、水利署水位站、交通部監視器等官方感測來源，也**不**做災害預測。

地方政府與中央各自有水情、災害、交通感測系統，時序與本協議的 `packet.ts` 可能落差數分鐘至數十分鐘。本協議**不**做跨源時序內插或對齊；跨源比對由 gateway、analysis-component 或政府端在已知時間誤差下處理。避免將 `severity` 解讀為「感測器讀數」或「即時災害指標」造成決策誤導。

## 10. 互通標籤是接收端提示
`agency-export` JSON 的 `receiver_tags` 與 `osm_tags_proposed` 是接收端整合提示，不改變 packet schema，也不表示本協議完整採納 HXL、GeoThings disaster ontology、CAP 或 EDXL。

`terrain_event` 中的前兆或在地觀察，例如 `mountain_rumbling`、`water_color_change`、`ground_cracking`、`sudden_animal_behavior`、`drainage_backflow`、`river_diverted`、`unusual_smell`，目前不強行映射到接收端標籤或 OSM。這些訊號保留原始 packet 欄位，交由接收端與地方專家判讀。

`consent_acknowledged` 與 `consent_refused` 屬隱私與操作紀錄邊界，不外送為接收端或 OSM 標籤。`requires_separated_space` 只映射到一般 vulnerable need，不推論敏感分類。

`terrain_event.severity` 是通行 / 撤離可行性的 4 級觀察，不等於 `damage_level`、建物紅黃綠標、醫療檢傷或官方災損評估。

參考來源： https://github.com/GeoThings/disaster-ontology/

## 11. Agency profile 範圍邊界

各 export profile 的資料範疇有明確邊界，邊界不是技術限制，而是「最小揭露」與「角色分工」的設計決策。

**social** 不包含 `rescue_needed` cluster。`rescue_needed` 由 `rescue` profile 承接，social 的入口是 `trapped`（人仍在現場需要安撫）。若地方 SOP 需要社工同步接收救援通報，由整合端訂閱 rescue 資料副本，不在協議層合併兩種操作邏輯。

**partner** 只看資源請求與提供，不看個別住戶通報、不看基礎設施事件。partner 定位是民間救助組織（NGO、教會、慈善基金會、民間自主緊急應變隊/T-CERT等），其操作入口是「我能提供什麼 / 哪裡需要什麼」，個人與家庭層級的資料不在其服務範疇，也不需要曝露。

**lifeline** 涵蓋 `power_outage_area`、`signal_lost`、`road_blocked`、`bridge_collapsed`。以下事件類型**不**在 current lifeline cluster filter 範圍：
- 自來水中斷（current packet schema 無對應 terrain_event）
- 瓦斯外洩（`unusual_smell` 涉及但不專屬）
- 數位通訊以外的網路基礎設施

未來若新增 terrain_event 類型，lifeline filter 須同步評估。

**healthcare** 不直接接收 rescue cluster。healthcare 的行動入口是醫療物資調度（`injured`、`special_needs`、`long_term_care` flags + `medical_aid` resource requests），救援座標由 `rescue` profile 掌握，傷者由現場移送後再介接。若現場同時需要救援與醫療，兩個 profile 並行訂閱，協議不在 healthcare 合併救援與醫療操作邏輯。
