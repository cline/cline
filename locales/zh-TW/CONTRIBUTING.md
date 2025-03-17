# 貢獻於 Roo Code

我們很高興您有興趣為 Roo Code 做出貢獻。無論您是修復錯誤、新增功能，還是改進我們的文檔，每一份貢獻都使 Roo Code 變得更智慧！為了保持我們社區的活力和友善，所有成員必須遵守我們的[行為準則](CODE_OF_CONDUCT.md)。

## 加入我們的社區

我們強烈鼓勵所有貢獻者加入我們的 [Discord 社區](https://discord.gg/roocode)！成為我們 Discord 伺服器的一部分可幫助您：

- 獲得關於您貢獻的即時幫助和指導
- 與其他貢獻者和核心團隊成員連接
- 了解專案發展和優先事項的最新情況
- 參與塑造 Roo Code 未來的討論
- 尋找與其他開發者合作的機會

## 報告錯誤或問題

錯誤報告有助於為每個人改進 Roo Code！在創建新問題之前，請[搜索現有問題](https://github.com/RooVetGit/Roo-Code/issues)以避免重複。當您準備報告錯誤時，請前往我們的[問題頁面](https://github.com/RooVetGit/Roo-Code/issues/new/choose)，在那裡您會找到幫助您填寫相關信息的模板。

<blockquote class='warning-note'>
     🔐 <b>重要：</b> 如果您發現安全漏洞，請使用 <a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">Github 安全工具私下報告</a>。
</blockquote>

## 決定從事何種工作

尋找一個良好的首次貢獻機會？查看我們 [Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) Github 專案中 "Issue [Unassigned]" 部分的問題。這些專門為新貢獻者及我們需要一些幫助的領域精心挑選！

我們也歡迎對我們的[文檔](https://docs.roocode.com/)進行貢獻！無論是修正錯別字、改進現有指南，還是創建新的教育內容 - 我們希望建立一個社區驅動的資源庫，幫助每個人充分利用 Roo Code。您可以點擊任何頁面上的 "Edit this page" 快速進入 Github 中編輯文件的正確位置，或者您可以直接進入 https://github.com/RooVetGit/Roo-Code-Docs。

如果您計劃從事更大的功能開發，請先創建一個[功能請求](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop)，這樣我們可以討論它是否符合 Roo Code 的願景。

## 開發設置

1. **克隆**存儲庫：

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **安裝依賴項**：

```sh
npm run install:all
```

3. **啟動網頁視圖（帶有 HMR 的 Vite/React 應用）**：

```sh
npm run dev
```

4. **調試**：
   在 VSCode 中按 `F5`（或**運行** → **開始調試**）打開一個加載了 Roo Code 的新會話。

網頁視圖的更改將立即顯示。核心擴展的更改將需要重新啟動擴展主機。

或者，您可以構建一個 .vsix 文件並直接在 VSCode 中安裝：

```sh
npm run build
```

一個 `.vsix` 文件將出現在 `bin/` 目錄中，可以使用以下命令安裝：

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

## 編寫和提交代碼

任何人都可以為 Roo Code 貢獻代碼，但我們要求您遵循以下準則，以確保您的貢獻能夠順利整合：

1. **保持拉取請求的專注性**

    - 將 PR 限制在單一功能或錯誤修復上
    - 將較大的更改分成較小的、相關的 PR
    - 將更改分成可以獨立審查的邏輯提交

2. **代碼質量**

    - 所有 PR 必須通過 CI 檢查，包括 linting 和格式化
    - 提交前解決任何 ESLint 警告或錯誤
    - 回應 Ellipsis（我們的自動代碼審查工具）的所有反饋
    - 遵循 TypeScript 最佳實踐並保持類型安全

3. **測試**

    - 為新功能添加測試
    - 運行 `npm test` 確保所有測試通過
    - 如果您的更改影響到它們，請更新現有測試
    - 在適當的情況下包括單元測試和集成測試

4. **提交準則**

    - 編寫清晰、描述性的提交消息
    - 使用 #issue-number 在提交中引用相關問題

5. **提交前**

    - 將您的分支重新基於最新的 main
    - 確保您的分支成功構建
    - 再次檢查所有測試是否通過
    - 檢查您的更改中是否有任何調試代碼或控制台日誌

6. **拉取請求描述**
    - 清楚描述您的更改做了什麼
    - 包括測試更改的步驟
    - 列出任何重大更改
    - 為 UI 更改添加截圖

## 貢獻協議

通過提交拉取請求，您同意您的貢獻將根據與專案相同的許可證（[Apache 2.0](../LICENSE)）進行許可。
