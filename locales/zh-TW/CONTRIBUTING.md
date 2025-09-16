<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • <b>繁體中文</b>

</sub>
</div>

# 為 Roo Code 做出貢獻

Roo Code 是一個由社群驅動的專案，我們非常重視每一份貢獻。為了簡化協作，我們採用 [「問題優先」的方法](#問題優先方法)，這意味著所有的 [拉取請求 (PR)](#提交拉取請求) 都必須先連結到一個 GitHub 問題。請仔細閱讀本指南。

## 目錄

- [在您貢獻之前](#在您貢獻之前)
- [尋找和規劃您的貢獻](#尋找和規劃您的貢獻)
- [開發和提交流程](#開發和提交流程)
- [法律](#法律)

## 在您貢獻之前

### 1. 行為準則

所有貢獻者都必須遵守我們的 [行為準則](./CODE_OF_CONDUCT.md)。

### 2. 專案路線圖

我們的路線圖指導著專案的方向。請將您的貢獻與這些關鍵目標保持一致：

### 可靠性第一

- 確保差異編輯和命令執行始終可靠。
- 減少阻礙常規使用的摩擦點。
- 保證在所有地區和平台上的流暢操作。
- 擴大對各種人工智慧提供商和模型的強大支援。

### 增強的使用者體驗

- 簡化使用者介面/使用者體驗，以提高清晰度和直觀性。
- 不斷改進工作流程，以滿足開發人員對日常使用工具的高期望。

### 在代理效能上領先

- 建立全面的評估基準 (evals) 來衡量真實世界的生產力。
- 讓每個人都能輕鬆執行和解釋這些評估。
- 發布能顯示評估分數明顯提高的改進。

在您的 PR 中提及與這些領域的一致性。

### 3. 加入 Roo Code 社群

- **主要方式：** 加入我們的 [Discord](https://discord.gg/roocode) 並私訊 **Hannes Rudolph (`hrudolph`)**。
- **替代方式：** 經驗豐富的貢獻者可以透過 [GitHub 專案](https://github.com/orgs/RooCodeInc/projects/1) 直接參與。

## 尋找和規劃您的貢獻

### 貢獻類型

- **錯誤修復：** 解決程式碼問題。
- **新功能：** 新增功能。
- **文件：** 改進指南和清晰度。

### 問題優先方法

所有貢獻都始於使用我們精簡範本的 GitHub 問題。

- **檢查現有問題**：在 [GitHub 問題](https://github.com/RooCodeInc/Roo-Code/issues) 中搜尋。
- **使用以下範本建立問題**：
    - **增強功能：** 「增強請求」範本（著重於使用者利益的簡單語言）。
    - **錯誤：** 「錯誤報告」範本（最少的重現步驟 + 預期與實際 + 版本）。
- **想參與其中嗎？** 在問題上評論“領取”，並在[Discord](https://discord.gg/roocode)上私訊 **Hannes Rudolph (`hrudolph`)** 以獲得分配。分配將在帖子中確認。
- **PR 必須連結到問題。** 未連結的 PR 可能會被關閉。

### 決定做什麼

- 查看 [GitHub 專案](https://github.com/orgs/RooCodeInc/projects/1) 中的「問題 [未分配]」問題。
- 如需文件，請造訪 [Roo Code 文件](https://github.com/RooCodeInc/Roo-Code-Docs)。

### 報告錯誤

- 首先檢查現有的報告。
- 使用 [「錯誤報告」範本](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) 建立一個新錯誤，並提供：
    - 清晰、編號的重現步驟
    - 預期與實際結果
    - Roo Code 版本（必需）；如果相關，還需提供 API 提供商/模型
- **安全問題**：透過 [安全公告](https://github.com/RooCodeInc/Roo-Code/security/advisories/new) 私下報告。

## 開發和提交流程

### 開發設定

1. **複製和克隆：**

```
git clone https://github.com/您的使用者名稱/Roo-Code.git
```

2. **安裝依賴項：**

```
pnpm install
```

3. **偵錯：** 使用 VS Code 開啟（`F5`）。

### 編碼指南

- 每個功能或修復一個集中的 PR。
- 遵循 ESLint 和 TypeScript 的最佳實踐。
- 編寫清晰、描述性的提交，並引用問題（例如，`修復 #123`）。
- 提供全面的測試（`npm test`）。
- 在提交前變基到最新的 `main` 分支。

### 提交拉取請求

- 如果希望獲得早期回饋，請以 **草稿 PR** 開始。
- 遵循拉取請求範本，清晰地描述您的變更。
- 在 PR 描述/標題中連結問題（例如，“修復 #123”）。
- 為使用者介面變更提供螢幕截圖/影片。
- 指明是否需要更新文件。

### 拉取請求政策

- 必須引用一個已分配的 GitHub 問題。要獲得分配：在問題上評論“領取”，並在[Discord](https://discord.gg/roocode)上私訊 **Hannes Rudolph (`hrudolph`)**。分配將在帖子中確認。
- 未連結的 PR 可能會被關閉。
- PR 必須通過 CI 測試，與路線圖保持一致，並有清晰的文件。

### 審查流程

- **每日分類：** 維護人員進行快速檢查。
- **每週深入審查：** 全面評估。
- **根據回饋及時迭代**。

## 法律

透過貢獻，您同意您的貢獻將根據 Apache 2.0 授權進行授權，這與 Roo Code 的授權一致。
