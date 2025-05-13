# 貢獻至 Cline

我們非常感謝您有意願貢獻至 Cline。無論是修正程式錯誤、新增功能或改善文件，每一份貢獻都能讓 Cline 更加出色！為了維持社群的活力與友善，所有成員都必須遵守我們的[行為準則](CODE_OF_CONDUCT.md)。

## 回報程式錯誤或問題

程式錯誤回報能幫助 Cline 變得更好！在建立新的議題之前，請先[搜尋現有議題](https://github.com/cline/cline/issues)，避免重複。當您準備好回報程式錯誤時，請前往我們的[議題頁面](https://github.com/cline/cline/issues/new/choose)，您會找到協助填寫相關資訊的範本。

<blockquote class='warning-note'>
    🔐 <b>重要：</b> 若您發現安全性漏洞，請使用 <a href="https://github.com/cline/cline/security/advisories/new">GitHub 安全性工具進行私密回報</a>。
</blockquote>

## 決定要處理的工作

想找適合第一次貢獻的工作嗎？請檢視標示為[「good first issue」](https://github.com/cline/cline/labels/good%20first%20issue)或[「help wanted」](https://github.com/cline/cline/labels/help%20wanted)的議題。這些議題特別適合新手貢獻者，我們也非常歡迎您的協助！

我們也歡迎對[文件](https://github.com/cline/cline/tree/main/docs)的貢獻！無論是修正錯字、改善現有指南或建立新的教學內容，我們都期待能建立一個由社群共同維護的知識庫，協助每個人充分運用 Cline。您可以從 `/docs` 開始，尋找需要改善的地方。

若您計畫處理較大的功能，請先建立一個[功能請求](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop)，以便我們討論該功能是否符合 Cline 的願景。

## 開發環境設定

1. **VS Code 擴充套件**
    - 開啟專案時，VS Code 會提示您安裝建議的擴充套件
    - 這些擴充套件是開發所需，請接受所有安裝提示
    - 若您已關閉提示，可從擴充套件面板手動安裝

2. **本機開發**
    - 執行 `npm run install:all` 安裝相依套件
    - 執行 `npm run test` 在本機執行測試
    - 提交 PR 前，執行 `npm run format:fix` 格式化您的程式碼

## 撰寫與提交程式碼

任何人都可以貢獻程式碼至 Cline，但我們要求您遵守以下指引，以確保您的貢獻能順利整合：

1. **保持 Pull Request 聚焦**
    - 每個 PR 限制在單一功能或錯誤修正
    - 將較大的變更拆分成較小且相關的 PR
    - 將變更拆分成邏輯性的提交，以便獨立審查

2. **程式碼品質**
    - 執行 `npm run lint` 檢查程式碼風格
    - 執行 `npm run format` 自動格式化程式碼
    - 所有 PR 必須通過包含程式碼風格檢查與格式化的 CI 檢查
    - 提交前解決所有 ESLint 警告或錯誤
    - 遵循 TypeScript 最佳實務並維持型別安全

3. **測試**
    - 為新功能新增測試
    - 執行 `npm test` 確保所有測試通過
    - 若您的變更影響現有測試，請更新測試
    - 適當時包含單元測試與整合測試

4. **使用 Changesets 管理版本**
    - 使用 `npm run changeset` 為任何面向使用者的變更建立 changeset
    - 選擇適當的版本升級：
        - `major` 重大變更 (1.0.0 → 2.0.0)
        - `minor` 新功能 (1.0.0 → 1.1.0)
        - `patch` 錯誤修正 (1.0.0 → 1.0.1)
    - 撰寫清晰且描述性的 changeset 訊息，說明影響
    - 僅文件變更不需建立 changeset

5. **提交指引**
    - 撰寫清晰且描述性的提交訊息
    - 使用慣用提交格式（例如：「feat:」、「fix:」、「docs:」）
    - 在提交中引用相關議題，使用 #issue-number

6. **提交前檢查**
    - 將您的分支 rebase 到最新的 main
    - 確保您的分支可以成功建置
    - 再次確認所有測試通過
    - 檢查您的變更是否包含除錯程式碼或 console 紀錄

7. **Pull Request 說明**
    - 清楚描述您的變更內容
    - 包含測試變更的步驟
    - 列出任何重大變更
    - 若有使用者介面變更，請附上截圖

## 貢獻協議

提交 Pull Request 即表示您同意您的貢獻將依照專案相同的授權條款（[Apache 2.0](LICENSE)）進行授權。

請記住：貢獻至 Cline 不只是撰寫程式碼，更是成為塑造 AI 輔助開發未來的社群一份子。讓我們一起打造令人驚艷的成果吧！🚀
