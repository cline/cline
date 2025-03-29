# Cline 擴充功能架構

此目錄包含 Cline VSCode 擴充功能的架構文件。

## 擴充功能架構圖

[extension-architecture.mmd](./extension-architecture.mmd) 檔案包含一個 Mermaid 圖表，顯示 Cline 擴充功能的高階架構。該圖表說明：

1. **核心擴充功能**
   - 擴充功能進入點和主要類別
   - 通過 VSCode 的全局狀態和秘密存儲進行狀態管理
   - Cline 類中的核心業務邏輯

2. **Webview UI**
   - 基於 React 的用戶界面
   - 通過 ExtensionStateContext 進行狀態管理
   - 組件層級結構

3. **存儲**
   - 用於歷史和狀態的任務特定存儲
   - 基於 Git 的檔案變更檢查點系統

4. **數據流**
   - 核心擴充功能組件之間的數據流
   - Webview UI 數據流
   - 核心與 Webview 之間的雙向通信

## 查看圖表

要查看圖表：
1. 在 VSCode 中安裝 Mermaid 圖表查看器擴充功能
2. 打開 extension-architecture.mmd
3. 使用擴充功能的預覽功能來渲染圖表

您也可以在 GitHub 上查看圖表，它具有內建的 Mermaid 渲染支持。

## 配色方案

圖表使用高對比度的配色方案以提高可見性：
- 粉紅色 (#ff0066)：全局狀態和秘密存儲組件
- 藍色 (#0066ff)：擴充功能狀態上下文
- 綠色 (#00cc66)：Cline 提供者
- 所有組件使用白色文字以達到最大可讀性