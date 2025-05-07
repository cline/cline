[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • <b>繁體中文</b>

# 參與 Roo Code 貢獻

Roo Code 是一個由社群驅動的專案，我們非常重視每一位貢獻者。為了讓每個人的貢獻流程順暢且有效率，**我們採用「[Issue-First](#2-關鍵原則-issue-first-方式)」原則。** 這代表所有工作都必須在提交 Pull Request _之前_ 先關聯一個 GitHub Issue（詳情請見[PR 政策](#pull-request-pr-政策)）。請仔細閱讀本指南，了解如何參與貢獻。
本指南說明如何為 Roo Code 做出貢獻，無論是修正 bug、加入新功能或完善文件。

## 目錄

- [I. 貢獻前須知](#i-貢獻前須知)
    - [1. 行為準則](#1-行為準則)
    - [2. 了解專案藍圖](#2-了解專案藍圖)
        - [Provider 支援](#provider-支援)
        - [模型支援](#模型支援)
        - [系統支援](#系統支援)
        - [文件](#文件)
        - [穩定性](#穩定性)
        - [國際化](#國際化)
    - [3. 加入 Roo Code 社群](#3-加入-roo-code-社群)
- [II. 尋找與規劃你的貢獻](#ii-尋找與規劃你的貢獻)
    - [1. 貢獻類型](#1-貢獻類型)
    - [2. 關鍵原則：Issue-First 方式](#2-關鍵原則-issue-first-方式)
    - [3. 決定要做什麼](#3-決定要做什麼)
    - [4. 回報 bug 或問題](#4-回報-bug-或問題)
- [III. 開發與提交流程](#iii-開發與提交流程)
    - [1. 開發環境設定](#1-開發環境設定)
    - [2. 程式碼規範](#2-程式碼規範)
    - [3. 提交程式碼：Pull Request (PR) 流程](#3-提交程式碼-pull-request-pr-流程)
        - [草稿 Pull Request](#草稿-pull-request)
        - [Pull Request 描述](#pull-request-描述)
        - [Pull Request (PR) 政策](#pull-request-pr-政策)
            - [目標](#目標)
            - [Issue-First 方式](#issue-first-方式)
            - [開放 PR 條件](#開放-pr-條件)
            - [流程](#流程)
            - [責任分工](#責任分工)
- [IV. 法律聲明](#iv-法律聲明)
    - [貢獻協議](#貢獻協議)

## I. 貢獻前須知

請先熟悉我們的社群標準與專案方向。

### 1. 行為準則

所有貢獻者都必須遵守我們的[行為準則](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md)。請在貢獻前仔細閱讀。

### 2. 了解專案藍圖

Roo Code 有明確的開發藍圖，指引我們的優先順序與未來方向。了解藍圖有助於你：

- 讓你的貢獻與專案目標一致
- 找到你最擅長的領域
- 理解某些設計決策的背景
- 激發新功能靈感，推動專案願景

目前藍圖聚焦六大核心：

#### Provider 支援

我們希望支援越多 Provider 越好：

- 更強的「OpenAI 相容」支援
- xAI、Microsoft Azure AI、Alibaba Cloud Qwen、IBM Watsonx、Together AI、DeepInfra、Fireworks AI、Cohere、Perplexity AI、FriendliAI、Replicate
- 強化 Ollama 與 LM Studio 支援

#### 模型支援

我們希望 Roo 能在越多模型（包含本地模型）上運作：

- 透過自訂系統提示詞與工作流程支援本地模型
- Benchmark 測試與案例

#### 系統支援

我們希望 Roo 能在所有電腦上順暢運作：

- 跨平台終端機整合
- 強大且一致地支援 Mac、Windows、Linux

#### 文件

我們希望為所有使用者與貢獻者提供完整、易用的文件：

- 擴充使用者指南與教學
- 清楚的 API 文件
- 更好的貢獻者指引
- 多語言文件資源
- 互動式範例與程式碼片段

#### 穩定性

我們希望大幅減少 bug 數量並提升自動化測試覆蓋：

- 除錯日誌開關
- 「機器/工作資訊」一鍵複製按鈕，方便 bug/支援請求

#### 國際化

我們希望 Roo Code 能說每個人的語言：

- 我們希望 Roo Code 說每個人的語言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

特別歡迎推動藍圖目標的貢獻。如果你的工作與這些方向相關，請在 PR 描述中說明。

### 3. 加入 Roo Code 社群

加入 Roo Code 社群是很好的起點：

- **主要方式**：
    1.  加入 [Roo Code Discord 社群](https://discord.gg/roocode)。
    2.  加入後，私訊 **Hannes Rudolph**（Discord: `hrudolph`），表達你的興趣並獲得指導。
- **有經驗的貢獻者可選**：如果你熟悉 Issue-First 方式，可以直接透過 GitHub 跟進 [看板](https://github.com/orgs/RooVetGit/projects/1)，用 issue 與 pull request 溝通。

## II. 尋找與規劃你的貢獻

明確你想做什麼以及如何進行。

### 1. 貢獻類型

我們歡迎多種形式的貢獻：

- **Bug 修正**：修正現有程式碼問題
- **新功能**：新增功能
- **文件**：完善指南、補充範例或修正錯字

### 2. 關鍵原則：Issue-First 方式

**所有貢獻都必須從 GitHub Issue 開始。** 這是確保協作一致、避免無效勞動的關鍵步驟。

- **查找或建立 Issue**：
    - 開始前，先在 [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) 檢查是否已有相關 issue。
    - 如果有且未分配，留言表達你想認領，維護者會分配給你。
    - 如果沒有，請在 [issues 頁面](https://github.com/RooVetGit/Roo-Code/issues/new/choose) 用合適模板新建：
        - Bug 用「Bug Report」模板
        - 新功能用「Detailed Feature Proposal」模板。開始實作前請等維護者（尤其是 @hannesrudolph）批准。
        - **注意**：功能初步想法或討論可在 [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests) 開始，具體後再建「Detailed Feature Proposal」issue。
- **認領與分配**：
    - 明確留言表達你要做某個 issue。
    - 等待維護者在 GitHub 正式分配，避免多人重複。
- **不遵守的後果**：
    - 未關聯、未批准、未分配的 PR 可能會被關閉，不做完整 review。此政策確保貢獻與專案優先順序一致，尊重大家的時間。

這有助於我們追蹤工作、確保變更是需要的，並高效協作。

### 3. 決定要做什麼

- **Good First Issues**：查看 GitHub [Roo Code Issues 專案](https://github.com/orgs/RooVetGit/projects/1) 的「未分配 Issue」區塊。
- **文件**：雖然本 `CONTRIBUTING.md` 是程式碼貢獻主指南，但如想參與其他文件（如使用者指南、API 文件），請參考 [Roo Code Docs 倉庫](https://github.com/RooVetGit/Roo-Code-Docs) 或在 Discord 社群詢問。
- **提出新功能**：
    1.  **初步想法/討論**：廣泛或初步想法可在 [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests) 討論。
    2.  **正式提案**：具體、可執行的建議請用 [issues 頁面](https://github.com/RooVetGit/Roo-Code/issues/new/choose) 的「Detailed Feature Proposal」模板新建 issue。這是 **Issue-First 方式** 的關鍵環節。

### 4. 回報 bug 或問題

如果你發現 bug：

1.  **查找已有 issue**：在 [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) 檢查是否已有人回報。
2.  **新建 issue**：如無重複，請用 [issues 頁面](https://github.com/RooVetGit/Roo-Code/issues/new/choose) 的「Bug Report」模板新建。

> 🔐 **安全漏洞**：如發現安全漏洞，請透過 [GitHub Security Advisory Tool](https://github.com/RooVetGit/Roo-Code/security/advisories/new) 私下回報。請勿公開 issue。

## III. 開發與提交流程

請依下列步驟進行開發與提交。

### 1. 開發環境設定

1.  **Fork & Clone**：
    - 在 GitHub 上 fork 本倉庫
    - 本地 clone 你的 fork：`git clone https://github.com/你的帳號/Roo-Code.git`
2.  **安裝相依套件**：`npm run install:all`
3.  **執行 Webview（開發模式）**：`npm run dev`（適用於 Vite/React 應用，支援 HMR）
4.  **除錯擴充功能**：在 VS Code 按 `F5`（或 **Run** → **Start Debugging**），開啟 Roo Code 的 Extension Development Host 視窗

webview（`webview-ui`）的變更會即時熱更新（HMR）。核心擴充（`src`）的變更需重啟 Extension Development Host。

也可建置並安裝 `.vsix` 套件：

```sh
npm run build
code --install-extension bin/roo-cline-<版本號>.vsix
```

（將 `<版本號>` 替換為實際產生的檔案版本號）

### 2. 程式碼規範

- **聚焦 PR**：每個 PR 只做一項功能/修正
- **程式碼品質**：
    - 通過 CI 檢查（lint、格式化）
    - 修正 ESLint 警告或錯誤（`npm run lint`）
    - 回應自動化程式碼審查工具意見
    - 遵循 TypeScript 最佳實踐，保持型別安全
- **測試**：
    - 新功能需加測試
    - 執行 `npm test`，確保所有測試通過
    - 如有影響，需更新現有測試
- **提交訊息**：
    - 撰寫清楚、具描述性的提交訊息
    - 用 `#issue-number`（如 `Fixes #123`）引用相關 issue
- **PR 提交前檢查**：
    - 將分支 rebase 到最新 upstream `main`
    - 確保程式碼可建置（`npm run build`）
    - 所有測試通過（`npm test`）
    - 移除除錯程式碼或 `console.log`

### 3. 提交程式碼：Pull Request (PR) 流程

#### 草稿 Pull Request

對於尚未準備好完整 review 的工作，請用草稿 PR：

- 執行自動檢查（CI）
- 提前獲得維護者或其他貢獻者回饋
- 標明工作進行中

只有當所有檢查通過，且你認為已滿足「程式碼規範」與「Pull Request 描述」要求時，才將 PR 標記為「Ready for Review」。

#### Pull Request 描述

你的 PR 描述必須完整，並遵循我們的 [Pull Request 模板](.github/pull_request_template.md) 結構。重點包括：

- 關聯的已批准 GitHub Issue 連結
- 變更內容及目的的清楚描述
- 測試變更的詳細步驟
- 所有 breaking changes 列表
- **UI 變更需提供前後截圖或影片**
- **如需更新使用者文件，請說明涉及哪些文件/區塊**

#### Pull Request (PR) 政策

##### 目標

保持清楚、聚焦、可管理的 PR backlog。

##### Issue-First 方式

- **必須**：開始前，需有已批准並分配的 GitHub Issue（「Bug Report」或「Detailed Feature Proposal」）
- **審核**：尤其是重大變更，需維護者（特別是 @hannesrudolph）提前審核
- **引用**：PR 描述中需明確引用這些已審核的 issue
- **後果**：不遵守流程的 PR 可能會被關閉，不做完整 review

##### 開放 PR 條件

- **可合併**：通過所有 CI 測試，符合藍圖（如適用），關聯已批准並分配的 issue，有清楚文件/註解，UI 變更有前後圖片/影片
- **需關閉**：CI 測試失敗、嚴重合併衝突、不符專案目標或長期（>30 天）無更新

##### 流程

1.  **Issue 資格審查與分配**：@hannesrudolph（或其他維護者）審查並分配新/現有 issue
2.  **初步 PR 篩查（每日）**：維護者快速檢查新 PR，篩選緊急或關鍵問題
3.  **詳細 PR 審查（每週）**：維護者詳細評估 PR 的準備度、與 issue 的一致性和整體品質
4.  **詳細回饋與修正**：根據審查回饋（Approve、Request Changes、Reject），貢獻者需及時回應和改進
5.  **決策階段**：通過的 PR 合併，無法解決或不符方向的 PR 說明原因後關閉
6.  **後續跟進**：被關閉 PR 的作者可根據回饋修正後重新提交

##### 責任分工

- **Issue 資格審查與流程把控（@hannesrudolph & 維護者）**：確保所有貢獻遵循 Issue-First 方式，指導貢獻者
- **維護者（開發團隊）**：初步/詳細審查 PR，提供技術回饋，決定批准/拒絕，合併 PR
- **貢獻者**：確保 PR 關聯已批准並分配的 issue，遵守品質規範，及時回應回饋

本政策確保流程清楚、高效整合。

## IV. 法律聲明

### 貢獻協議

提交 Pull Request 即表示你同意你的貢獻將以 [Apache 2.0 授權條款](LICENSE)（或專案現行授權）釋出，與專案一致。
