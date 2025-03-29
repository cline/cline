# 從 GitHub 儲存庫建置 MCP 伺服器

本指南提供如何使用 Cline 從 GitHub 儲存庫建置現有 MCP 伺服器的逐步走查。

## **尋找 MCP 伺服器**

在線上有多個地方可以找到 MCP 伺服器：

-   **Cline 可以自動將 MCP 伺服器添加到其列表中，您可以隨後進行編輯。** Cline 可以直接從 GitHub 克隆儲存庫並為您建置伺服器。
-   **GitHub：** 在 GitHub 上找到 MCP 伺服器的兩個最常見的地方包括：
    -   [官方 MCP 伺服器儲存庫](https://github.com/modelcontextprotocol/servers)
    -   [Awesome-MCP 伺服器儲存庫](https://github.com/punkpeye/awesome-mcp-servers)
-   **線上目錄：** 幾個網站列出了 MCP 伺服器，包括：

    -   [mcpservers.org](https://mcpservers.org/)
    -   [mcp.so](https://mcp.so/)
    -   [glama.ai/mcp/servers](https://glama.ai/mcp/servers)

    這些目錄允許用戶按各種標準對伺服器進行排序，例如下載量、日期、星級和使用案例。每個條目提供的信息包括功能、工具和配置說明。

-   **PulseMCP：** 該網站有一篇討論 AI 如何使用 MCP 伺服器使網站過時的博客文章。PulseMCP 還包括一個關於 MCP 伺服器的常見問題解答部分：[https://www.pulsemcp.com/](https://www.pulsemcp.com/)

## **使用 Cline 建置**

1.  **啟動流程：** 向 Cline 提供以下信息：
    -   **GitHub 儲存庫 URL：** 伺服器儲存庫的 URL。
    -   **README.md 內容：** 這是可選的，但有助於 Cline 了解伺服器的目的和配置。您可以從 GitHub 儲存庫複製 README.md 文件。
2.  **與 Cline 的示例互動：**

    ```
    User: "Cline，我想添加 Brave 瀏覽器控制的 MCP 伺服器。這裡是 GitHub 鏈接：https://github.com/modelcontextprotocol/servers/tree/main/src/brave 你能添加它嗎？"

    Cline: "好的。正在將儲存庫克隆到 MCP 目錄中。由於它有一個 'package.json' 文件，需要建置。我應該運行 'npm run build' 嗎？"

    User: "是的，建置它。"

    Cline: "建置完成。這個伺服器需要瀏覽器路徑。你的 Brave 瀏覽器可執行文件在哪裡？"

    User: "它在 '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'。"

    Cline: "好的。我已使用該路徑更新了伺服器配置，並將其添加到 'cline_mcp_settings.json' 中。還有其他事嗎？"

    User: "沒有，這就是全部。讓我們測試它。"

    Cline: "很好！正在啟動 MCP 檢查器來測試伺服器連接。之後，我們可以嘗試從 Cline 控制瀏覽器。"
    ```
3. **Cline的行動：** 根據您的指示，Cline將執行以下操作：
    - **存儲庫克隆：** Cline將存儲庫克隆到您的本地機器，通常在您配置中指定的目錄中。
    - **調整：** 您可以指導Cline修改伺服器的配置。例如：
        - **用戶：** "這個伺服器需要API金鑰。你能找到應該添加的位置嗎？"
        - Cline可能會根據您的指示自動更新`cline_mcp_settings.json`文件或其他相關文件。
    - **構建伺服器：** Cline將運行適當的構建命令來構建伺服器，通常是`npm run build`。
    - **將伺服器添加到設置中：** Cline將伺服器的配置添加到`cline_mcp_settings.json`文件中。

## **測試與故障排除**

1. **測試伺服器：** 一旦Cline完成構建過程，請測試伺服器以確保其按預期工作。如果您遇到任何問題，Cline可以協助您。
2. **MCP檢查器：** 您可以使用MCP檢查器來測試伺服器的連接和功能。

## **最佳實踐**

- **了解基礎知識：** 雖然Cline簡化了過程，但了解伺服器的代碼、MCP協議()以及如何配置伺服器是有益的。這有助於更有效的故障排除和自定義。
- **清晰的指示：** 在整個過程中，對Cline提供清晰且具體的指示。
- **測試：** 在安裝和配置後，徹底測試伺服器以確保其正確運作。
- **版本控制：** 使用版本控制系統（如Git）來追蹤伺服器代碼的變更。
- **保持更新：** 保持您的MCP伺服器更新，以獲取最新的功能和安全補丁。