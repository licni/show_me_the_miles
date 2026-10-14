# 維護規則

這是使用者授權資料公開的 GitHub Pages 版本，名稱 `show_me_the_miles`，發布根目錄為本儲存庫根目錄。原 Cloudflare 網站為另一個版本，不因本repo更新而修改。

開始修改前讀 docs/REQUIREMENTS.md、docs/AI_HANDOFF.md、docs/AI_HISTORY.md、README.md。每次更新同步維護需求、接手及歷程，依變更執行相稱驗證。不得把成功推送當成已成功上線；檢查 Pages 狀態。不要記錄密碼、token或使用者即時位置。

保留現有里程規則、所有省道共用中心線、交會候選、60m判讀界線、缺口與推估標示。資料按道路延遲載入，不要開站就下載完整模型。保留手機版面與手機隱藏匯出入口。Google Maps分享必須指向查得位置。

資料更新時同步JSON／gzip及manifest雜湊與1km索引；相同道路須保留完整校準、端點、引道關係；合併分檔時維持原始順序，避免改變等距候選排序。所有資產、模組、背景Worker與資料URL必須在 `/show_me_the_miles/` 子路徑下可用，不可新增根目錄 `/api/` 網路依賴。
