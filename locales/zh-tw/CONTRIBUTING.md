# 貢獻於 Cline

我們很高興您有興趣為 Cline 做出貢獻。無論您是修復錯誤、添加功能還是改進我們的文檔，每一個貢獻都讓 Cline 更加智能！為了保持我們的社區充滿活力和歡迎，所有成員必須遵守我們的[行為準則](CODE_OF_CONDUCT.md)。

## 報告錯誤或問題

錯誤報告有助於讓 Cline 對每個人都更好！在創建新問題之前，請[搜索現有問題](https://github.com/cline/cline/issues)以避免重複。當您準備報告錯誤時，請前往我們的[問題頁面](https://github.com/cline/cline/issues/new/choose)，您會找到一個模板來幫助您填寫相關信息。

<blockquote class='warning-note'>
    🔐 <b>重要：</b> 如果您發現安全漏洞，請使用<a href="https://github.com/cline/cline/security/advisories/new">Github 安全工具私下報告</a>。
</blockquote>

## 決定要做什麼

尋找一個好的首次貢獻？查看標有["good first issue"](https://github.com/cline/cline/labels/good%20first%20issue)或["help wanted"](https://github.com/cline/cline/labels/help%20wanted)的問題。這些是專門為新貢獻者和我們希望得到幫助的領域策劃的！

我們也歡迎對我們[文檔](https://github.com/cline/cline/tree/main/docs)的貢獻！無論是修正錯別字、改進現有指南還是創建新的教育內容 - 我們希望建立一個由社區驅動的資源庫，幫助每個人充分利用 Cline。您可以從深入研究 `/docs` 並尋找需要改進的領域開始。

如果您計劃開發一個更大的功能，請先創建一個[功能請求](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop)，以便我們討論它是否符合 Cline 的願景。

## 開發設置

1. **VS Code 擴展**

    - 打開項目時，VS Code 會提示您安裝推薦的擴展
    - 這些擴展是開發所需的 - 請接受所有安裝提示
    - 如果您忽略了提示，可以從擴展面板手動安裝它們

2. **本地開發**
    - 運行 `npm run install:all` 安裝依賴項
    - 運行 `npm run test` 本地運行測試
    - 提交 PR 之前，運行 `npm run format:fix` 格式化您的代碼

## 編寫和提交代碼

任何人都可以為 Cline 貢獻代碼，但我們要求您遵循以下指南，以確保您的貢獻能夠順利集成：

1. **保持 Pull Requests 集中**

    - 將 PR 限制在單個功能或錯誤修復
    - 將較大的更改拆分為較小的相關 PR
    - 將更改分為邏輯提交，可以獨立審查

2. **代碼質量**

    - 運行 `npm run lint` 檢查代碼風格
    - 運行 `npm run format` 自動格式化代碼
    - 所有 PR 必須通過包括 lint 和格式化在內的 CI 檢查
    - 提交前解決所有 ESLint 警告或錯誤
    - 遵循 TypeScript 最佳實踐並保持類型安全

3. **測試**

    - 為新功能添加測試
    - 運行 `npm test` 確保所有測試通過
    - 如果您的更改影響現有測試，請更新它們
    - 在適當的地方包括單元測試和集成測試

4. **提交指南**

    - 撰寫清晰、描述性的提交消息
    - 使用常規提交格式（例如 "feat:"、"fix:"、"docs:"）
    - 在提交中引用相關問題，使用 #issue-number

5. **提交前**

    - 將您的分支重新基於最新的 main
    - 確保您的分支成功構建
    - 仔細檢查所有測試是否通過
    - 檢查您的更改是否有任何調試代碼或控制台日誌

6. **Pull Request 描述**
    - 清楚地描述您的更改內容
    - 包括測試更改的步驟
    - 列出任何重大更改
    - 為 UI 更改添加截圖

## 貢獻協議

通過提交 pull request，您同意您的貢獻將根據與項目相同的許可證（[Apache 2.0](LICENSE)）進行許可。

記住：貢獻於 Cline 不僅僅是編寫代碼 - 這是關於成為一個塑造 AI 輔助開發未來的社區的一部分。讓我們一起創造一些驚人的東西！🚀
