# 維護歷程

## 2026-10-14 首次公開發布準備

使用者允許公開計算資料，要求GitHub Pages功能與現站一致；隨後指定名稱show_me_the_miles並建立公開repo。以既有已驗證的靜態發布包上傳本repo，沒有更改里程算法或原Cloudflare main。

驗證：1,538筆原Worker／瀏覽器版結果一致、24真實網格邊界、背景Worker訊息、依賴與子路徑、資料manifest／JSON／gzip大小及內容雜湊一致。此輪核对新名稱不需重新運行未改動的全部算法測試。

上傳前repo只有README，has_pages=false。正式Pages尚未啟用；上傳檔案不等於網站已上線。

本次提交：348個公開檔案完成Git blob上傳並逐一比對內容SHA，統一更新main；初始README保留在Git歷史。Pages仍需帳號管理者啟用，未宣稱正式網址已可用。
