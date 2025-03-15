# Cline – OpenRouter 上的 \#1

<p align="center">
    <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
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
<a href="https://cline.bot/join-us" target="_blank"><strong>我們正在招聘！</strong></a>
</td>
</tbody>
</table>
</div>

認識 Cline，一個可以使用你的 **CLI** 和 **編輯器** 的 AI 助手。

感謝 [Claude 3.7 Sonnet 的代理編碼能力](https://www.anthropic.com/claude/sonnet)，Cline 可以一步步處理複雜的軟件開發任務。通過允許他創建和編輯文件、探索大型項目、使用瀏覽器和執行終端命令（在你授予權限後），他可以提供超越代碼完成或技術支持的幫助。Cline 甚至可以使用 Model Context Protocol (MCP) 創建新工具並擴展自己的能力。雖然自主 AI 腳本傳統上在沙盒環境中運行，但此擴展提供了一個人機交互的 GUI 來批准每個文件更改和終端命令，提供了一種安全且可訪問的方式來探索代理 AI 的潛力。

1. 輸入你的任務並添加圖像，將模型轉換為功能應用程序或通過截圖修復錯誤。
2. Cline 首先分析你的文件結構和源代碼 AST，運行正則表達式搜索，並閱讀相關文件以了解現有項目。通過仔細管理添加到上下文中的信息，Cline 即使在大型複雜項目中也能提供有價值的幫助，而不會使上下文窗口過載。
3. 一旦 Cline 獲得所需信息，他可以：
        - 創建和編輯文件 + 監控 linter/編譯器錯誤，從而主動修復諸如缺少導入和語法錯誤等問題。
        - 直接在你的終端中執行命令並監控其輸出，從而在編輯文件後對開發服務器問題做出反應。
        - 對於 Web 開發任務，Cline 可以在無頭瀏覽器中啟動網站，點擊、輸入、滾動並捕獲截圖和控制台日誌，從而修復運行時錯誤和視覺錯誤。
4. 當任務完成時，Cline 將通過終端命令如 `open -a "Google Chrome" index.html` 向你展示結果，你可以通過點擊按鈕運行該命令。

> [!提示]
> 使用 `CMD/CTRL + Shift + P` 快捷鍵打開命令面板並輸入 "Cline: Open In New Tab" 將擴展作為標籤在編輯器中打開。這讓你可以與文件資源管理器並排使用 Cline，更清楚地看到他如何改變你的工作空間。

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### 使用任何 API 和模型

Cline 支持 OpenRouter、Anthropic、OpenAI、Google Gemini、AWS Bedrock、Azure 和 GCP Vertex 等 API 提供商。你還可以配置任何兼容 OpenAI 的 API，或通過 LM Studio/Ollama 使用本地模型。如果你使用 OpenRouter，擴展會獲取他們的最新模型列表，讓你在新模型可用時立即使用。

擴展還會跟蹤整個任務循環和單個請求的總令牌和 API 使用成本，讓你在每一步都了解支出情況。

<!-- 透明像素以在浮動圖像後創建換行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### 在終端中運行命令

感謝 VSCode v1.93 中的新 [終端 shell 集成更新](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api)，Cline 可以直接在你的終端中執行命令並接收輸出。這使他能夠執行廣泛的任務，從安裝包和運行構建腳本到部署應用程序、管理數據庫和執行測試，同時適應你的開發環境和工具鏈以正確完成工作。

對於長時間運行的進程如開發服務器，使用“在運行時繼續”按鈕讓 Cline 在命令後台運行時繼續任務。當 Cline 工作時，他會在過程中收到任何新的終端輸出通知，讓他對可能出現的問題做出反應，例如編輯文件時的編譯時錯誤。

<!-- 透明像素以在浮動圖像後創建換行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### 創建和編輯文件

Cline 可以直接在你的編輯器中創建和編輯文件，向你展示更改的差異視圖。你可以直接在差異視圖編輯器中編輯或恢復 Cline 的更改，或在聊天中提供反饋，直到你對結果滿意。Cline 還會監控 linter/編譯器錯誤（缺少導入、語法錯誤等），以便他在過程中自行修復出現的問題。

Cline 所做的所有更改都會記錄在你的文件時間軸中，提供了一種簡單的方法來跟蹤和恢復修改（如果需要）。

<!-- 透明像素以在浮動圖像後創建換行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### 使用瀏覽器

借助 Claude 3.5 Sonnet 的新 [計算機使用](https://www.anthropic.com/news/3-5-models-and-computer-use) 功能，Cline 可以啟動瀏覽器，點擊元素，輸入文本和滾動，在每一步捕獲截圖和控制台日誌。這允許進行交互式調試、端到端測試，甚至是一般的網頁使用！這使他能夠自主修復視覺錯誤和運行時問題，而無需你親自操作和複製粘貼錯誤日誌。

試試讓 Cline “測試應用程序”，看看他如何運行 `npm run dev` 命令，在瀏覽器中啟動你本地運行的開發服務器，並執行一系列測試以確認一切正常。[在這裡查看演示。](https://x.com/sdrzn/status/1850880547825823989)

<!-- 透明像素以在浮動圖像後創建換行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### “添加一個工具……”

感謝 [Model Context Protocol](https://github.com/modelcontextprotocol)，Cline 可以通過自定義工具擴展他的能力。雖然你可以使用 [社區製作的服務器](https://github.com/modelcontextprotocol/servers)，但 Cline 可以創建和安裝適合你特定工作流程的工具。只需讓 Cline “添加一個工具”，他將處理所有事情，從創建新的 MCP 服務器到將其安裝到擴展中。這些自定義工具將成為 Cline 工具包的一部分，準備在未來的任務中使用。

- “添加一個獲取 Jira 工單的工具”：檢索工單 AC 並讓 Cline 開始工作
- “添加一個管理 AWS EC2 的工具”：檢查服務器指標並上下擴展實例
- “添加一個獲取最新 PagerDuty 事件的工具”：獲取詳細信息並讓 Cline 修復錯誤

<!-- 透明像素以在浮動圖像後創建換行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### 添加上下文

**`@url`：** 粘貼一個 URL 以供擴展獲取並轉換為 markdown，當你想給 Cline 提供最新文檔時非常有用

**`@problems`：** 添加工作區錯誤和警告（“問題”面板）以供 Cline 修復

**`@file`：** 添加文件內容，這樣你就不必浪費 API 請求批准讀取文件（+ 輸入以搜索文件）

**`@folder`：** 一次添加文件夾的文件，以進一步加快你的工作流程

<!-- 透明像素以在浮動圖像後創建換行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### 檢查點：比較和恢復

當 Cline 完成任務時，擴展會在每一步拍攝你的工作區快照。你可以使用“比較”按鈕查看快照和當前工作區之間的差異，並使用“恢復”按鈕回滾到該點。

例如，當使用本地 Web 服務器時，你可以使用“僅恢復工作區”快速測試應用程序的不同版本，然後在找到要繼續構建的版本時使用“恢復任務和工作區”。這讓你可以安全地探索不同的方法而不會丟失進度。

<!-- 透明像素以在浮動圖像後創建換行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 貢獻

要為項目做出貢獻，請從我們的 [貢獻指南](CONTRIBUTING.md) 開始，了解基礎知識。你還可以加入我們的 [Discord](https://discord.gg/cline) 在 `#contributors` 頻道與其他貢獻者聊天。如果你正在尋找全職工作，請查看我們在 [招聘頁面](https://cline.bot/join-us) 上的開放職位！

<details>
<summary>本地開發說明</summary>

1. 克隆倉庫 _(需要 [git-lfs](https://git-lfs.com/))_：
        ```bash
        git clone https://github.com/cline/cline.git
        ```
2. 在 VSCode 中打開項目：
        ```bash
        code cline
        ```
3. 安裝擴展和 webview-gui 的必要依賴：
        ```bash
        npm run install:all
        ```
4. 按 `F5`（或 `運行`->`開始調試`）啟動以打開一個加載了擴展的新 VSCode 窗口。（如果你在構建項目時遇到問題，可能需要安裝 [esbuild problem matchers 擴展](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers)）

</details>

## 許可證

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
