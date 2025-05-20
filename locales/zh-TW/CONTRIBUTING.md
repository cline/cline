[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • <b>繁體中文</b>

# 參與 Roo Code 貢獻

Roo Code 是一個由社群驅動的專案，我們深深重視每一份貢獻。為了簡化協作流程，我們採用 [Issue-First](#issue-first-方式) 原則，這表示所有 [Pull Request (PR)](#提交-pull-request) 必須先關聯至 GitHub Issue。請仔細閱讀本指南。

## 目錄

- [貢獻前須知](#貢獻前須知)
- [尋找與規劃你的貢獻](#尋找與規劃你的貢獻)
- [開發與提交流程](#開發與提交流程)
- [法律聲明](#法律聲明)

## 貢獻前須知

### 1. 行為準則

所有貢獻者必須遵守我們的[行為準則](./CODE_OF_CONDUCT.md)。

### 2. 專案藍圖

我們的藍圖指引專案方向。請將你的貢獻與這些關鍵目標保持一致：

### 可靠性優先

- 確保差異編輯和命令執行始終可靠
- 減少阻礙常規使用的摩擦點
- 確保在所有語言環境和平台上順暢運行
- 擴展對各種 AI 供應商和模型的強大支援

### 增強使用者體驗

- 簡化使用者介面，提高清晰度和直覺性
- 持續改進工作流程，滿足開發者對日常工具的高期望

### 引領代理效能

- 建立全面的評估基準（evals）衡量實際工作中的生產力
- 讓每個人都能輕鬆執行和解讀這些評估
- 提供明顯提升評分的改進

在 PR 中請提及與這些領域的關聯。

### 3. 加入 Roo Code 社群

- **主要方式：** 加入我們的 [Discord](https://discord.gg/roocode) 並私訊 **Hannes Rudolph (`hrudolph`)**。
- **替代方式：** 有經驗的貢獻者可透過 [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1) 直接參與。

## 尋找與規劃你的貢獻

### 貢獻類型

- **Bug 修正：** 解決程式碼問題。
- **新功能：** 新增功能。
- **文件：** 完善指南和提高清晰度。

### Issue-First 方式

所有貢獻必須從 GitHub Issue 開始。

- **檢查現有 issue：** 搜尋 [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues)。
- **建立 issue：** 使用適當範本：
    - **Bug：** 「Bug Report」範本。
    - **功能：** 「Detailed Feature Proposal」範本。開始前需獲得批准。
- **認領 issue：** 留言並等待正式分配。

**未關聯已批准 issue 的 PR 可能會被關閉。**

### 決定要做什麼

- 查看 [GitHub 專案](https://github.com/orgs/RooCodeInc/projects/1) 中未分配的「Good First Issues」。
- 文件相關，請訪問 [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs)。

### 回報 Bug

- 先檢查是否已有相關報告。
- 使用 [「Bug Report」範本](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) 建立新 bug 報告。
- **安全問題：** 透過 [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new) 私下回報。

## 開發與提交流程

### 開發環境設定

1. **Fork & Clone：**

```
git clone https://github.com/你的帳號/Roo-Code.git
```

2. **安裝相依套件：**

```
npm run install:all
```

3. **除錯：** 在 VS Code 中按 `F5` 開啟。

### 程式碼規範

- 每個 PR 專注於一個功能或修正。
- 遵循 ESLint 和 TypeScript 最佳實踐。
- 撰寫清晰的提交訊息，引用相關 issue（如 `Fixes #123`）。
- 提供完整測試（`npm test`）。
- 提交前先在最新 `main` 分支上進行 rebase。

### 提交 Pull Request

- 如需早期回饋，可先提交**草稿 PR**。
- 清晰描述你的更改，遵循 Pull Request 範本。
- 為 UI 變更提供截圖/影片。
- 說明是否需要更新文件。

### Pull Request 政策

- 必須引用已批准並分配的 issue。
- 不遵守政策的 PR 可能會被關閉。
- PR 應通過 CI 測試，符合藍圖，並有清晰文件。

### 審查流程

- **每日篩查：** 維護者快速檢查。
- **每週深入審查：** 全面評估。
- **根據回饋快速迭代**。

## 法律聲明

提交貢獻即表示你同意你的貢獻將基於 Apache 2.0 授權條款，與 Roo Code 的授權一致。
