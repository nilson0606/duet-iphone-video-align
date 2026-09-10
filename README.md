# 合拍 DUET

以 iPhone Safari 為主要使用環境的雙影片融合編輯器。檔案、音訊分析與編碼均留在瀏覽器，不上傳使用者影片。

## 使用

1. 選取兩段含相同事件聲音的影片，或按「載入測試影片」。
2. 按「用音訊自動對齊」。不確定的結果需要人工確認，也可手動指定時間差。
3. 拖曳任一影片，拉右下角改變大小；使用水平位置、垂直位置、寬度、高度欄位精準配置。可解開比例鎖，調整前後層級，選擇橫式、直式或方形畫布。
4. 融合，預覽，透過系統分享或下載保存。iPhone 使用 HTTPS 網站，在分享選單選「儲存影片」；網站不能直接寫入照片圖庫，也無法確認使用者是否完成儲存。

## 時間軸定義

offset > 0 表示 A 的歌曲段落需前進 offset 秒才能與 B 對應，裁掉 A 開頭 offset 秒；offset < 0 則裁 B。這是音樂位置的差值，不是實際拍攝時間差；影片可以在不同時間、不同場景拍攝。**保留前端對齊後最長的尾段；較短影片播放結束後，其矩形區域持續畫成不透明黑色**，即使它在另一部影片上層也不透出下層。輸出聲音僅用使用者選擇的音軌，該音軌先結束時，其後靜音。

## 範圍與限制

- 初版每部 3 秒至 3 分鐘、250 MB 以下。長片或高解析度來源可能超過手機記憶體或解碼能力，失敗時需縮短或降解析度。
- 以 50 Hz 六頻帶音訊變化特徵與 FFT 互相關估計固定時間差；非時鐘飄移、變速錄影或多段剪輯校正。高度週期性聲音、嚴重失真、無音訊可能需要手動調整。
- 使用 Canvas + Web Audio + MediaRecorder 即時輸出，30 fps、長邊 1280（方形 720）。輸出約需影片長度的時間，需保持前景。偵測背景切換、播放卡住或嚴重雙片漂移時取消，避免交付明顯損壞的結果。
- 優先 MP4/H.264/AAC，依瀏覽器能力退回 WebM，副檔名保持正確。WebM 不保證能存入 iPhone 照片。
- 使用 MediaRecorder 的雙播放器輸出不保證逐幀精準或 HDR 色彩保真。真機 Safari 的 HEVC、HDR、長片、分享及編码行為仍需實測。
- 第一版不儲存專案；重新整理會清除所選來源和未下載輸出。

## 本機開發

Node 22.13+（測試直接執行 TypeScript 需較新的 Node；此工作環境使用 Node 24）。

```sh
npm install
npm run dev -- --host 0.0.0.0
npm run typecheck
npm test
npm run build
```

重建素材需 Python 及 PATH 上的 FFmpeg：`npm run demo:generate`。測試對齊使用 FFmpeg 解碼實際 AAC 音軌。素材 A 為 22 秒，素材 B 為 14 秒、晚開始 2.34 秒；兩者有獨立噪音。對齊後輸出 19.66 秒，B 最後 5.66 秒為黑幕。

## 驗證紀錄

- 10 個核心測試涵蓋含噪 AAC 素材、反向差值、相同音訊、靜音、無關音訊、完整尾段、無效差值、黑幕遮蓋、繪圖順序與 FFT 回轉。
- 型別檢查與正式編譯另執行確認。
- 尚未在實體 iPhone 操作，也未執行瀏覽器端端到端錄製驗證。
- WebMCP 僅提供 read_video_composition_status，透過 feature detection 註冊；此環境沒有支援的 WebMCP 驗證 context，未驗證該契約。

參考：

- https://webkit.org/blog/11353/mediarecorder-api/
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

本次編輯器範圍（app、lib、tests、scripts）的 oxlint 與 TypeScript 檢查通過。完整 `npm run lint` 尚有產生器預載、未使用的 components/ui 與 hooks 的既有規則錯誤；保留原始範例檔案，未停用其檢查規則。

## 音訊分析修正

正式版 Worker URL 改為由瀏覽器網址解析，避免伺服器編譯把 import.meta.url 固定為 file:///ROOT 路徑。六頻帶特徵加上對稱 100 ms 平滑以抑制不同錄音環境的快速噪音變化；信心門檻維持不變。新增 Worker 生命週期測試，以及 npm run test:build 驗證正式輸出路徑和編譯後分析程式。使用者實拍影片僅在本機驗證，不納入 repo 或網站。
