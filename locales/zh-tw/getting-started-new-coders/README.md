# 開始使用 Cline | 新手程式設計師

歡迎來到 Cline！本指南將幫助您設置並開始使用 Cline 來構建您的第一個項目。

## 您將需要的東西

在開始之前，請確保您擁有以下項目：

-   **VS Code：** 一款免費且強大的程式碼編輯器。
    -   [下載 VS Code](https://code.visualstudio.com/)
-   **開發工具：** 編碼的基本軟體（Homebrew、Node.js、Git 等）。
    -   按照我們的[安裝基本開發工具](installing-dev-essentials.md)指南，在 Cline 的幫助下設置這些工具（在這裡設置後）
    -   Cline 將指導您安裝所有需要的東西
-   **Cline 項目資料夾：** 專門用於所有 Cline 項目的資料夾。
    -   在 macOS 上：在您的文件夾中創建一個名為 "Cline" 的資料夾
        -   路徑：`/Users/[your-username]/Documents/Cline`
    -   在 Windows 上：在您的文件夾中創建一個名為 "Cline" 的資料夾
        -   路徑：`C:\Users\[your-username]\Documents\Cline`
    -   在這個 Cline 資料夾內，為每個項目創建獨立的資料夾
        -   例如：`Documents/Cline/workout-app` 用於健身追蹤應用程式
        -   例如：`Documents/Cline/portfolio-website` 用於您的作品集
-   **VS Code 中的 Cline 擴展：** 在 VS Code 中安裝的 Cline 擴展。

-   這裡有一個[教學](https://www.youtube.com/watch?v=N4td-fKhsOQ)，介紹您開始所需的一切。

## 逐步設置

按照以下步驟來啟動並運行 Cline：

1. **開啟 VS Code：** 啟動 VS Code 應用程式。如果 VS Code 顯示 "Running extensions might..."，請點擊 "Allow"。

2. **開啟您的 Cline 資料夾：** 在 VS Code 中，開啟您在文件夾中創建的 Cline 資料夾。

3. **導航到擴展：** 點擊 VS Code 側邊活動欄中的擴展圖示。

4. **搜索 'Cline'：** 在擴展搜索欄中輸入 "Cline"。

5. **安裝擴展：** 點擊 Cline 擴展旁邊的 "Install" 按鈕。

6. **開啟 Cline：** 安裝後，您可以通過幾種方式開啟 Cline：
    - 點擊活動欄中的 Cline 圖示。
    - 使用命令調色板（`CMD/CTRL + Shift + P`）並輸入 "Cline: Open In New Tab" 以在編輯器中以新標籤的方式開啟 Cline。這是為了獲得更好的視圖而推薦的。
    - **故障排除：** 如果您看不到 Cline 圖示，請嘗試重新啟動 VS Code。
    - **您將看到什麼：** 您應該會在您的 VS Code 編輯器中看到 Cline 聊天窗口。

![gettingStartedVsCodeCline](https://github.com/user-attachments/assets/622b4bb7-859b-4c2e-b87b-c12e3eabefb8)

## 設置 OpenRouter API 金鑰

現在您已經安裝了 Cline，您需要設置您的 OpenRouter API 金鑰以使用 Cline 的全部功能。
1.  **獲取您的 OpenRouter API 金鑰：**
    -   [獲取您的 OpenRouter API 金鑰](https://openrouter.ai/)
2.  **輸入您的 OpenRouter API 金鑰：**
    -   導航至 Cline 擴充功能中的設置按鈕。
    -   輸入您的 OpenRouter API 金鑰。
    -   選擇您偏好的 API 模型。
        -   **推薦的編碼模型：**
            -   `anthropic/claude-3.5-sonnet`：最常用於編碼任務。
            -   `google/gemini-2.0-flash-exp:free`：免費的編碼選項。
            -   `deepseek/deepseek-chat`：超級便宜，幾乎與 3.5 sonnet 一樣好
        -   [OpenRouter 模型排名](https://openrouter.ai/rankings/programming)

## 您與 Cline 的第一次互動

現在您已準備好開始使用 Cline 進行開發。讓我們創建您的第一個項目資料夾並構建一些東西！將以下提示複製並貼入 Cline 聊天窗口：

```
Hey Cline! 你能幫我創建一個名為 "hello-world" 的新項目資料夾在我的 Cline 目錄中，並製作一個簡單的網頁，上面用大藍色文字顯示 "Hello World" 嗎？
```

**您將看到：** Cline 將幫助您創建項目資料夾並設置您的第一個網頁。

## 使用 Cline 的提示

-   **提問：** 如果您對某事不確定，請不要猶豫，向 Cline 提問！
-   **使用螢幕截圖：** Cline 可以理解圖像，所以隨意使用螢幕截圖來展示您正在做什麼。
-   **複製並貼上錯誤：** 如果您遇到錯誤，請將錯誤消息複製並貼入 Cline 的聊天中。這將幫助他理解問題並提供解決方案。
-   **使用簡單的語言：** Cline 設計用來理解簡單的非技術性語言。隨意用您自己的話描述您的想法，Cline 將其轉譯成代碼。

## 常見問題

-   **什麼是終端機？** 終端機是一個基於文本的界面，用於與您的電腦互動。它允許您運行命令來執行各種任務，例如安裝軟體包、運行腳本和管理文件。Cline 使用終端機來執行命令並與您的開發環境互動。
-   **代碼庫是如何運作的？** （本節將根據新編碼者的常見問題進行擴展）

## 仍然有困難？

隨時聯繫我，我將幫助您開始使用 Cline。

nick | 608-558-2410

加入我們的 Discord 社群：[https://discord.gg/cline](https://discord.gg/cline)