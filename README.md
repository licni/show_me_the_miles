# show_me_the_miles

SHOW ME THE MILESTONE 樁號查詢 — GitHub Pages 公開版。

預定網址：https://licni.github.io/show_me_the_miles/ （首次發布需啟用 Pages。）

## 首次啟用

儲存庫 Settings → Pages → Build and deployment → Source 選 **Deploy from a branch**，Branch 選 **main**，資料夾選 **/ (root)**，按 Save。發布完成後用上述 HTTPS 網址開啟。

## 功能

- TWD97／經緯度、GPS、地圖點選查樁號；樁號反查位置。
- 省道共用中心線、順逆樁側別、里程路段、多點標記、道路資料範圍。
- 一般地圖、正射影像、影像加標籤；按鈕載入目前畫面的道路參考線。
- Google Maps 導航／分享；桌面 JPG／PNG 匯出，手機隱藏匯出按鈕。

樁號在瀏覽器背景 Web Worker 計算，不依賴 Cloudflare API。開站只載入介面與索引，查詢時下載相關道路；支持瀏覽器解壓縮時使用gzip，否則使用JSON。157條有樁號道路＋1條純參考道路；資料按使用者授權公開可下載。

本儲存庫根目錄就是可發布內容，包含 `.nojekyll`。必須以 HTTP/HTTPS 網頁伺服器執行，不能直接雙擊 HTML。底圖仍需連網至 OSM／國土測繪中心；GPS需使用者授權。推估資料不等同現地測量，原有缺口與精度限制保持。

## 驗證與維護

2026-10-14：沿用原站介面與計算規則，完整回歸及1,538筆靜態版／原Worker結果一致性通過；另驗證24個真實索引格邊界、背景訊息、資料快取／重試、gzip／JSON相容及專案子目錄。正式GitHub Pages與手機GPS仍待上線驗收。

`data/manifest.json` 指向內容雜湊命名的道路／參考線檔。修改資料時同時更新JSON、gzip、雜湊、索引與manifest，避免前後版本混用。`engine/` 為計算引擎，`pages/` 為背景計算與按需載入器。

Leaflet授權：`vendor/LEAFLET-LICENSE.txt`。底圖及道路來源署名保留於地圖。
