# Cline 工具參考指南

## Cline 能做什麼？

Cline 是您的 AI 助手，可以：

-   編輯和創建項目中的文件
-   執行終端命令
-   搜索和分析您的代碼
-   幫助調試和修復問題
-   自動化重複性任務
-   與外部工具整合

## 第一步

1. **開始任務**

    - 在聊天中輸入您的請求
    - 示例："創建一個名為 Header 的新 React 組件"

2. **提供上下文**

    - 使用 @ 提及添加文件、資料夾或 URL
    - 示例："@file:src/components/App.tsx"

3. **檢閱變更**
    - Cline 會在進行變更前顯示差異
    - 您可以編輯或拒絕變更

## 主要功能

1. **文件編輯**

    - 創建新文件
    - 修改現有代碼
    - 在文件間搜索和替換

2. **終端命令**

    - 執行 npm 命令
    - 啟動開發服務器
    - 安裝依賴項

3. **代碼分析**

    - 查找並修復錯誤
    - 重構代碼
    - 添加文檔

4. **瀏覽器整合**
    - 測試網頁
    - 捕捉螢幕截圖
    - 檢查控制台日誌

## 可用的工具

如需最新的實現細節，您可以查看 [Cline 倉庫](https://github.com/cline/cline/blob/main/src/core/Cline.ts)中的完整源代碼。

Cline 可以訪問以下工具來執行各種任務：

1. **文件操作**

    - `write_to_file`：創建或覆蓋文件
    - `read_file`：讀取文件內容
    - `replace_in_file`：對文件進行針對性編輯
    - `search_files`：使用正則表達式搜索文件
    - `list_files`：列出目錄內容

2. **終端操作**

    - `execute_command`：執行 CLI 命令
    - `list_code_definition_names`：列出代碼定義

3. **MCP 工具**

    - `use_mcp_tool`：使用來自 MCP 服務器的工具
    - `access_mcp_resource`：訪問 MCP 服務器資源
    - 用戶可以創建自定義的 MCP 工具，Cline 隨後可以訪問
    - 示例：創建一個天氣 API 工具，Cline 可以用來獲取天氣預報

4. **互動工具**
    - `ask_followup_question`：向用戶尋求澄清
    - `attempt_completion`：呈現最終結果

每個工具都有特定的參數和使用模式。以下是一些示例：

-   創建新文件（write_to_file）：

    ```xml
    <write_to_file>
    <path>src/components/Header.tsx</path>
    <content>
    // Header 組件代碼
    </content>
    </write_to_file>
    ```

-   搜索模式（search_files）：

    ```xml
    <search_files>
    <path>src</path>
    <regex>function\s+\w+\(</regex>
    <file_pattern>*.ts</file_pattern>
    </search_files>
    ```

-   執行命令（execute_command）：
    ```xml
    <execute_command>
    <command>npm install axios</command>
    <requires_approval>false</requires_approval>
    </execute_command>
    ```

## 常見任務

1. **創建新組件**

    - "創建一個名為 Footer 的新 React 組件"

2. **修復錯誤**

    - "修復 src/utils/format.ts 中的錯誤"

3. **重構代碼**

    - "將 Button 組件重構為使用 TypeScript"

4. **執行命令**
    - "執行 npm install 以添加 axios"

## 獲取幫助

-   [加入 Discord 社群](https://discord.gg/cline)
-   查看文檔
-   提供反饋以改進 Cline