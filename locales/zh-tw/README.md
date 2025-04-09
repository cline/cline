<div align="center"><sub>
<a href="https://github.com/cline/cline/blob/main/README.md" target="_blank">English</a> | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | 繁體中文 | <a href="https://github.com/cline/cline/blob/main/locales/ko/README.md" target="_blank">한국어</a>
</sub></div>

# Cline – OpenRouter 第一名的 AI 工具

<p align="center">
    <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>從 VS Marketplace 下載</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>功能建議</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/getting-started/getting-started-new-coders" target="_blank"><strong>新手上路</strong></a>
</td>
</tbody>
</table>
</div>

認識一下 Cline，一個可以操作你的 **終端機** 和 **編輯器** 的 AI 助手。

得益於 [Claude 3.7 Sonnet 的代理式編碼能力](https://www.anthropic.com/claude/sonnet)，Cline 能夠逐步處理複雜的軟體開發任務。借助一系列工具，他可以建立與編輯檔案、瀏覽大型專案、使用瀏覽器，並在你授權後執行終端機指令，從而在程式碼補全或技術支援之外提供更深入的協助。Cline 甚至還能使用 Model Context Protocol（MCP）來建立新工具並擴充自身的能力。雖然傳統的自動化 AI 指令碼通常在沙盒環境中執行，但這個擴充功能提供了一個有人類參與審核的圖形介面（GUI），用來審批每一次檔案變更與終端機指令，讓探索代理式 AI 的潛力變得更安全且更容易上手。

1. 輸入你的任務，並加入圖片，將介面設計圖（mockup）轉換為功能應用，或透過截圖來修復錯誤（bug）。
2. Cline 會從分析你的檔案結構與原始碼的抽象語法樹（AST）開始，同時執行正則表達式搜尋並讀取相關檔案，以便快速熟悉專案上下文。透過精細地管理加入上下文的資訊，即使面對大型且複雜的專案，Cline 也能在不超出上下文視窗限制的情況下提供有效協助。
3. 一旦獲取所需資訊，Cline 能夠：
   - 建立與編輯檔案，並在過程中監控 Linter 或編譯器錯誤，主動修復像是缺少匯入、語法錯誤等問題。
   - 直接在你的終端機中執行指令，並在執行時監控其輸出，例如在修改檔案後，自動回應開發伺服器錯誤。
   - 針對 Web 開發任務，Cline 可以在無頭瀏覽器中啟動網站，執行點擊、輸入、滾動等操作，並擷取截圖與主控台日誌，從而修復執行時錯誤與畫面問題。
4. 任務完成後，Cline 會透過類似 `open -a "Google Chrome" index.html` 的終端機指令將結果呈現給你，你只需點擊按鈕即可執行。

> [!TIP]
> 使用 `CMD/CTRL + Shift + P` 快速鍵開啟命令選擇區，輸入「Cline: Open In New Tab」即可在編輯器中以分頁方式開啟擴充套件。這讓您可以同時檢視檔案總管，並更清楚地看到 Cline 如何變更您的工作區。

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### 使用任何 API 和模型

Cline 支援 OpenRouter、Anthropic、OpenAI、Google Gemini、AWS Bedrock、Azure 和 GCP Vertex 等 API 提供者。您也可以設定任何與 OpenAI 相容的 API，或透過 LM Studio/Ollama 使用本機模型。若您使用 OpenRouter，此擴充套件會擷取他們最新的模型列表，讓您能在新模型推出時立即使用。

此擴充套件也會追蹤整個任務迴圈和個別請求的 token 總數和 API 使用成本，讓您隨時掌握費用支出。

<!-- 透明像素用於浮動圖片後的換行 -->
<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### 在終端機中執行指令

感謝 [VSCode v1.93 的終端機整合更新](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api)，Cline 可以直接在您的終端機中執行指令並接收輸出。這讓他能執行各種任務，從安裝套件和執行建置腳本到部署應用程式、管理資料庫和執行測試，同時適應您的開發環境和工具鏈，以正確完成工作。

對於開發伺服器等長時間執行的程序，使用「繼續執行中的程序」按鈕讓 Cline 在指令於背景執行時繼續任務。當 Cline 工作時，他會收到任何新的終端機輸出通知，讓他能回應可能出現的問題，例如編輯檔案時的編譯錯誤。

<!-- 透明像素用於浮動圖片後的換行 -->
<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### 建立和編輯檔案

Cline 可以直接在您的編輯器中建立和編輯檔案，並顯示變更的差異檢視。您可以直接在差異檢視編輯器中編輯或還原 Cline 的變更，或在聊天中提供意見回饋，直到您滿意結果為止。Cline 也會監控程式碼檢查工具/編譯器的錯誤（缺少的匯入語句、語法錯誤等），讓他能自行修正過程中出現的問題。

所有 Cline 做的變更都會記錄在您檔案的時間軸中，提供簡單的方式來追蹤和還原修改。

<!-- 透明像素用於浮動圖片後的換行 -->
<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### 使用瀏覽器

透過 Claude 3.5 Sonnet 的新[電腦使用](https://www.anthropic.com/news/3-5-models-and-computer-use)功能，Cline 可以啟動瀏覽器、點選元素、輸入文字和捲動，在每個步驟擷取螢幕截圖和主控台記錄。這讓互動式除錯、端對端測試，甚至一般網頁使用成為可能！這讓他能獨立修正視覺問題和執行時錯誤，而不需要您手動複製錯誤記錄。

試著請 Cline 「測試應用程式」，觀察他如何執行 `npm run dev`、在瀏覽器中啟動您的本機開發伺服器，並執行一系列測試來確認一切正常運作。[點此觀看示範](https://x.com/sdrzn/status/1850880547825823989)。

<!-- 透明像素用於浮動圖片後的換行 -->
<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### 「新增一個工具來...」

感謝[模型上下文協定](https://github.com/modelcontextprotocol)，Cline 可以透過自訂工具擴展他的功能。雖然您可以使用[社群製作的伺服器](https://github.com/modelcontextprotocol/servers)，但 Cline 可以改為建立專門為您的工作流程量身打造的工具。只要請 Cline 「新增工具」，他就會處理所有事情，從建立新的 MCP 伺服器到將其安裝到擴充套件中。這些自訂工具就會成為 Cline 工具箱的一部分，隨時可用於未來的任務。

- 「新增一個擷取 Jira 工單的工具」：取得工單驗收條件並讓 Cline 開始工作
- 「新增一個管理 AWS EC2 的工具」：檢查伺服器指標並調整執行個體規模
- 「新增一個擷取最新 PagerDuty 事件的工具」：取得詳細資訊並請 Cline 修復錯誤

<!-- 透明像素用於浮動圖片後的換行 -->
<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### 新增上下文

**`@url`：**貼上網址讓擴充套件擷取並轉換為 Markdown，當您想給 Cline 最新文件時很有用
**`@problems`：**新增工作區的錯誤和警告（「問題」面板）給 Cline 修正
**`@file`：**新增檔案內容，讓您不必浪費 API 請求來核准讀取檔案（+ 輸入以搜尋檔案）
**`@folder`：**一次新增整個資料夾的檔案，讓您的工作流程更快速

<!-- 透明像素用於浮動圖片後的換行 -->
<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### 檢查點：比較和還原

當 Cline 處理任務時，擴充套件會在每個步驟擷取您工作區的快照。您可以使用「比較」按鈕檢視快照與目前工作區的差異，並使用「還原」按鈕回到該時間點。

例如，在使用本機網頁伺服器時，您可以使用「僅還原工作區」來快速測試應用程式的不同版本，然後在找到想要繼續開發的版本時使用「還原任務和工作區」。這讓您能安全地探索不同方法而不會失去進度。

<!-- 透明像素用於浮動圖片後的換行 -->
<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 貢獻

要為專案貢獻，請先閱讀我們的[貢獻指南](CONTRIBUTING.md)來了解基礎知識。您也可以加入我們的 [Discord](https://discord.gg/cline)，在 `#contributors` 頻道與其他貢獻者交流。如果您在尋找全職工作，請檢視我們[職涯頁面](https://cline.bot/join-us)上的職缺！

<details>
<summary>本機開發說明</summary>

1. 複製程式碼庫（需要 [git-lfs](https://git-lfs.com/)）：

    ```bash
    git clone https://github.com/cline/cline.git
    ```

2. 在 VSCode 中開啟專案：

    ```bash
    code cline
    ```

3. 安裝擴充套件和網頁介面所需的相依套件：

    ```bash
    npm run install:all
    ```

4. 按下 `F5`（或選擇「執行」->「開始除錯」）來啟動並開啟一個已載入擴充套件的新 VSCode 視窗。（如果建置專案時遇到問題，您可能需要安裝 [esbuild problem matchers 擴充套件](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers)）

</details>

<details>
<summary>建立 Pull Request</summary>

1. 在建立 PR 前，產生一個 changeset 項目：

    ```bash
    npm run changeset
    ```

   這會提示您填寫：
   - 變更類型（major、minor、patch）
     - `major` → 重大變更（1.0.0 → 2.0.0）
     - `minor` → 新功能（1.0.0 → 1.1.0）
     - `patch` → 錯誤修正（1.0.0 → 1.0.1）
   - 您的變更說明

2. 提交您的變更和產生的 `.changeset` 檔案

3. 推送您的分支並在 GitHub 上建立 PR。我們的 CI 會：
   - 執行測試和檢查
   - Changesetbot 會建立一個顯示版本影響的評論
   - 當合併到 main 時，changesetbot 會建立一個 Version Packages PR
   - 當 Version Packages PR 合併時，就會發布新版本

</details>

## 授權條款

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
