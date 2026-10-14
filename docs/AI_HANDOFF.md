# 接手摘要

這是可直接以GitHub Pages main / (root)發布的靜態網站，無需npm建置或伺服器API。首頁app.mjs透過pages/client.mjs傳送訊息給pages/query-worker.mjs；model-loader依data/manifest.json索引抓完整相關道路，engine/query-service.mjs使用相同查詢引擎。所有路徑支援GitHub專案子目錄。

原版來源提交f4938185ce340f8ebebe99c8153347c6a7c0e0e4；公開版來源提交06f8b039ae9cb027934e37d8e9131707ae1ea417。發布目標依使用者指定改為show_me_the_miles，取代先前建議名稱milestone-pages。

158道路分片（157有里程）、1,243索引格；manifest71,888B，全部道路gzip7,916,006B，參考線gzip292,248B。啟動原始程式與索引約368KB；不會下載整包模型。原始JSON大小24MiB作為快取淘汰門檻，並非總記憶體上限保證。

已通過原站完整回歸、1,538筆回應一致性、24真實跨格、背景訊息、快取重試、gzip／JSON與子路徑檢查。真實瀏覽器／手機GPS及正式Pages仍待驗收。首次Pages需在Settings啟用Deploy from a branch / main / (root)，目前工具沒有Pages管理操作。
