<div align="center"><sub>
English | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">繁體中文</a>
</sub></div>

# Cline：您嚴肅工程工作的協作型 AI 夥伴

藉由全協作的 AI 夥伴，徹底改造您的工程團隊。這是一個開源、完全可擴展，且專為提升開發者影響力而設計的工具。

<p align="center">
  <video alt="展示 Cline AI 代理協作開發功能的示範" autoplay loop muted playsinline width="100%">
    <source src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demoForWebsiteNew.mp4" type="video/mp4">
  </video>
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>在 VS Marketplace 下載</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>功能請求</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/getting-started/getting-started-new-coders" target="_blank"><strong>快速上手</strong></a>
</td>
</tbody>
</table>
</div>

Cline 不僅僅是一個自律代理，它是您優化開發工作流程的 AI 夥伴。在採取行動前，Cline 會與您共同規劃計畫，解釋其推理過程，並逐步拆解複雜任務。透過建立與編輯檔案、瀏覽專案與執行命令等工具，Cline 全程監控您的環境——從終端機、檔案到錯誤日誌——確保工作順暢進行。

傳統的 AI 腳本通常在受限的沙盒環境中運作，而 Cline 提供了具有人機互動的圖形介面，讓您能夠批准每一次檔案更改與終端命令。結合 MCP（模型上下文協議）的整合，Cline 可擴展至外部資料庫與即時文件，自動偵測問題並進行修正，使您能專注於創新。此工具以企業級安全性為設計理念，讓您能透過 AWS Bedrock、GCP Vertex 或 Azure 終端存取頂尖模型，同時確保程式碼安全。

1. 輸入您的任務並添加圖片，將設計稿轉換為功能性應用，或利用截圖修正錯誤。
2. Cline 首先會分析您的檔案結構與原始程式碼的 AST，使用正則表達式搜尋並讀取相關檔案，以便迅速熟悉現有專案。透過謹慎管理加入上下文中的資訊，即使是大型複雜專案也能獲得有價值的支援，而不會讓上下文視窗過載。
3. 當 Cline 取得必要資訊後，它便可以：
    - 建立與編輯檔案，同時監控 linter/編譯器錯誤，主動修正例如缺失導入與語法錯誤等問題。
    - 直接在終端機中執行命令並監控其輸出，例如在編輯檔案後對開發伺服器的問題做出反應。
    - 對於網頁開發任務，Cline 能在無頭瀏覽器中啟動網站，進行點擊、輸入與滾動，並捕捉截圖與控制台日誌，以修正執行時錯誤及視覺問題。
4. 當任務完成後，Cline 會以類似 `open -a "Google Chrome" index.html` 的終端命令向您展示結果，您只需輕點即可執行該命令。

> [!TIP]
> 請使用快捷鍵 `CMD/CTRL + Shift + P` 開啟命令面板，並輸入 “Cline: Open In New Tab” 以在編輯器中以新分頁打開擴充功能。如此一來，您可以與檔案瀏覽器並排使用 Cline，更清楚地查看工作區的變化。

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4" alt="Cline 靈活的模型整合介面">

### 使用任意 API 與模型

Cline 支援 OpenRouter、Anthropic、OpenAI、Google Gemini、AWS Bedrock、Azure 以及 GCP Vertex 等 API 供應商。您亦可設定任何相容 OpenAI 的 API，或透過 LM Studio/Ollama 使用本地模型。若您使用 OpenRouter，擴充功能將取得最新的模型清單，讓您能即時使用最新模型。

此外，擴充功能還會追蹤整個任務流程與個別請求的總 token 數及 API 使用費用，確保您能隨時掌握花費情形。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76" alt="Cline 終端命令執行介面">

### 在終端機中執行命令

藉由 [VSCode v1.93 中的終端機整合更新](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api)，Cline 可直接在終端機中執行命令並接收輸出。這使得它能夠完成從安裝軟體包、執行編譯腳本到部署應用、管理資料庫及執行測試等各項任務，同時依照您的開發環境與工具鏈正確完成工作。

對於如開發伺服器等長時間運行的程序，請使用「運行中繼續」按鈕，讓 Cline 在命令於背景中運行時仍可持續執行任務。在此過程中，Cline 會接收新的終端輸出，從而能及時應對檔案編輯時出現的編譯錯誤等問題。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588" alt="Cline 帶有 diff 視圖的檔案編輯介面">

### 建立與編輯檔案

Cline 可直接在您的編輯器中建立與編輯檔案，並以 diff 視圖展示所做的變更。您可以直接在 diff 視圖中編輯或還原 Cline 的修改，亦可透過聊天室提供回饋，直至滿意為止。此外，Cline 還會監控 linter/編譯錯誤（如缺少導入、語法錯誤等），以便自動修正問題。

所有由 Cline 所做的修改都會記錄在檔案的時間軸中，方便您追蹤並在必要時回退變更。

<!-- Transparent pixel to create line break after floating image -->

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5" alt="Cline 瀏覽器自動化介面">

### 使用瀏覽器

藉由 Claude 3.5 Sonnet 的新[電腦使用](https://www.anthropic.com/news/3-5-models-and-computer-use)功能，Cline 可啟動瀏覽器、點擊網頁元素、輸入文字與滾動頁面，並在每一步捕捉截圖與控制台日誌。這讓互動式除錯、端對端測試乃至日常網頁操作都變得可能，而無需您手動複製貼上錯誤日誌，便可自動修正視覺錯誤與運行時問題。

試著讓 Cline “測試應用程式”，觀察它如何執行例如 `npm run dev` 的命令、在瀏覽器中啟動本地開發伺服器，並進行一連串測試以確認一切正常。[觀看示範](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd" alt="Cline MCP 工具建立介面">

### “新增一個工具……”

藉由 [Model Context Protocol](https://github.com/modelcontextprotocol)，Cline 可以透過自訂工具來擴展功能。您可以使用[社群伺服器](https://github.com/modelcontextprotocol/servers)，或者讓 Cline 自行建立並安裝完全符合您工作流程需求的工具。只需告訴 Cline “新增一個工具”，它便會從建立新的 MCP 伺服器到將其安裝到擴充功能中，自動處理所有步驟。這些自訂工具將成為 Cline 工具箱的一部分，可用於未來的任務。

- “新增一個工具來取得 Jira 工單”：抓取工單代碼並讓 Cline 開始運作。
- “新增一個工具來管理 AWS EC2”：監控伺服器指標，並依需求擴展或縮減實例。
- “新增一個工具來拉取最新的 PagerDuty 事件”：取得詳細資訊，並讓 Cline 修正錯誤。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970" alt="Cline 上下文管理介面">

### 新增上下文

**`@url`：** 貼上 URL，擴充功能會將其抓取並轉換成 Markdown，方便您提供最新文件給 Cline。

**`@problems`：** 新增工作區錯誤與警告（「問題」面板），讓 Cline 進行修正。

**`@file`：** 新增檔案內容，節省批准讀取檔案所需的 API 請求次數。

**`@folder`：** 一次性新增整個資料夾中的所有檔案，進一步加速您的工作流程。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb" alt="Cline 檢查點比對介面">

### 企業級安全

在 Cline 執行任務期間，擴充功能會在每個步驟捕捉工作區快照。您可以使用「比對」按鈕來查看快照與目前工作區之間的差異，並點選「還原」按鈕回到先前狀態。

例如，在本地開發伺服器上作業時，您可以使用「僅還原工作區」選項快速測試應用的不同版本，當選定欲繼續開發的版本後，再選擇「還原任務與工作區」。這使您能夠在不失去進度的情況下，安全地嘗試不同方案。

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 貢獻

若您想為此專案做出貢獻，請先參閱我們的 [貢獻指南](CONTRIBUTING.md) 以瞭解基本情況。您也可以加入我們的 [Discord](https://discord.gg/cline)，在 `#contributors` 頻道與其他貢獻者交流。若您正在尋找全職工作，請瀏覽我們的 [徵才頁面](https://cline.bot/join-us)。

<details>
<summary>本地開發說明</summary>

1. 克隆程式碼庫 _(需要 [git-lfs](https://git-lfs.com/))_：
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. 在 VSCode 中開啟專案：
    ```bash
    code cline
    ```
3. 安裝擴充功能及 webview-gui 所需的依賴：
    ```bash
    npm run install:all
    ```
4. 按下 `F5` 鍵（或選擇「執行」→「開始除錯」）以開啟一個載入了擴充功能的新 VSCode 視窗。（若在建置專案時遇到問題，可能需要安裝 [esbuild problem matchers 擴充功能](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers)。）

</details>

<details>
<summary>建立 Pull Request</summary>

1. 在建立 PR 前，先生成一個 changeset 條目：
    ```bash
    npm run changeset
    ```
   系統將要求您提供：
   - 變更類型（major, minor, patch）
     - `major` → 重大變更 (1.0.0 → 2.0.0)
     - `minor` → 新功能 (1.0.0 → 1.1.0)
     - `patch` → Bug 修正 (1.0.0 → 1.0.1)
   - 您的變更描述

2. 提交您的修改及生成的 `.changeset` 檔案

3. 推送您的分支並在 GitHub 上建立 PR。我們的 CI 將會：
   - 執行測試與檢查
   - 由 Changesetbot 建立一則顯示版本影響的評論
   - 當合併至主分支後，Changesetbot 會建立一個版本包 PR
   - 當版本包 PR 合併後，將發布新版本

</details>

## 授權條款

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
