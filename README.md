# SHIFT

兩個重疊次元的潛行探索遊戲 + 關卡編輯器。設計規則見 [DESIGN.md](DESIGN.md)（遊戲與引擎的唯一準則）。

## 執行

```bash
npm install
npm run dev        # http://localhost:5173/ 遊戲、/editor.html 編輯器
npm run check      # 型別檢查 + 單元測試 + 關卡驗證
npm run validate   # 只驗證 levels/*.json（可帶檔名）
npm run build      # 輸出 dist/（靜態網站，編輯器只能下載 JSON，不能直接存檔）
npm run models     # 用 Blender 重建角色模型（BLENDER=<blender.exe> 或專案旁的 blender-* 資料夾）
```

## 操作

WASD 移動（以鏡頭為準）・滑鼠 / ←→ 轉鏡頭・**按住 Shift 潛行**（怪物視野半徑減半）・**輕點 Shift 轉移次元**（兩側腳下都是空塊時）・E 拉桿・Space 揮劍（只對靈魂有效）・R 重來

## 製作關卡

1. `npm run dev`，開 `/editor.html`。
2. 上方「新增」或從下拉選單開啟既有關卡。左右（或上下）兩個面板分別是次元 A、B，完全獨立。
3. 工具：**畫筆 B**（右鍵擦）・**選取 V**（編參數）・**怪物 M**（放置後自動切到路徑）・**路徑 P**（加巡邏點，右鍵刪最後一點）。數字鍵 1-8 切換方塊。
4. 顯示選項：靈魂路徑（另一側怪物在此側的移動軌跡）、視野預覽。
5. 右側驗證即時更新：結構、頻道連結、怪物路徑、**可解性求解**（不計怪物）。點問題可跳到該格。
6. **Ctrl+Enter 試玩**，**Ctrl+S 存檔**到 `levels/<id>.json`。遊戲按 id 排序載入所有關卡。
7. 提交前跑 `npm run check`。

關卡 JSON 一列一行，方便 diff；格式見 DESIGN.md §5。

## 架構

```
src/core/     純邏輯（無 three.js / DOM，可在 Node 測試）
  blocks.ts     方塊 registry — 唯一真相來源
  level.ts      關卡資料模型、解析、正規化序列化
  grid.ts       查詢層：實心/遮擋、轉移點、射線、碰撞
  sim.ts        確定性遊戲模擬
  solver.ts     可解性 BFS
  validate.ts   驗證器（CLI、測試、編輯器共用）
src/render/   three.js 畫面：像素管線、角色、方塊模型 registry、GameView
src/game/     輸入、主迴圈、HUD、關卡清單
src/editor/   關卡編輯器
levels/       關卡檔
tests/        單元測試（含 level01 依設計路線、怪物開啟狀態下的完整通關）
```

### 新增一種方塊

1. `src/core/blocks.ts` 加一筆（字元、名稱、顏色、參數 schema、solid/opaque、behavior）。
2. `src/render/blockModels.ts` 加同 id 的模型工廠。
3. 需要新行為時，在 `sim.ts`（遊戲）與 `solver.ts`（可解性）處理該 behavior。
4. `npm run check` — 測試會檢查字元唯一、每個方塊都有模型。

編輯器的調色盤、參數面板、驗證器會自動跟上。
