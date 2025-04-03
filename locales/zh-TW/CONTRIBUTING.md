# 參與貢獻 Roo Code

我們非常歡迎您參與貢獻 Roo Code。無論是修正錯誤、新增功能或改善文件，每一份貢獻都能讓 Roo Code 變得更加出色！為了維持社群的活力與友善氛圍，所有成員皆須遵守我們的[行為準則](CODE_OF_CONDUCT.md)。

## 加入我們的社群

我們強烈建議所有貢獻者加入我們的 [Discord 社群](https://discord.gg/roocode)！加入 Discord 伺服器後，您可以：

- 即時取得貢獻相關的協助與指引
- 與其他貢獻者及核心團隊成員交流
- 掌握專案的最新進展與優先事項
- 參與討論，共同塑造 Roo Code 的未來
- 尋找與其他開發者合作的機會

## 回報錯誤或問題

回報錯誤能幫助我們改善 Roo Code！在建立新議題前，請先[搜尋現有議題](https://github.com/RooVetGit/Roo-Code/issues)，避免重複回報。當您準備好回報錯誤時，請前往我們的 [議題頁面](https://github.com/RooVetGit/Roo-Code/issues/new/choose)，您將找到協助填寫相關資訊的範本。

<blockquote class='warning-note'>
     🔐 <b>重要：</b> 若您發現安全性漏洞，請透過 <a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">GitHub 安全性通報工具進行私密回報</a>。
</blockquote>

## 決定貢獻方向

正在尋找適合新手的貢獻機會嗎？請查看我們 [Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) GitHub 專案中的「Issue [Unassigned]」區塊。這些議題特別適合新進貢獻者，也是我們最需要協助的領域！

我們也歡迎您對[文件](https://docs.roocode.com/)提出貢獻！無論是修正錯字、改善現有指南，或建立新的教學內容，我們都希望打造一個由社群推動的知識庫，協助每個人充分運用 Roo Code。您可以點選任何頁面上的「編輯此頁面」按鈕，快速前往 GitHub 上的檔案編輯介面，或直接造訪 https://github.com/RooVetGit/Roo-Code-Docs。

若您計畫開發較大型的功能，請先建立一個[功能請求](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop)，讓我們能討論該功能是否符合 Roo Code 的願景。您也可以參考下方的[專案藍圖](#專案藍圖)，確認您的想法是否符合我們的策略方向。

## 專案藍圖

Roo Code 擁有明確的開發藍圖，指引我們的優先事項與未來方向。了解我們的藍圖能協助您：

- 讓您的貢獻與專案目標保持一致
- 找到最能發揮您專長的領域
- 理解特定設計決策的脈絡
- 為支援我們願景的新功能尋找靈感

目前的藍圖聚焦於六大核心支柱：

### 供應商支援

我們致力於完善各家供應商的支援：

- 對於「OpenAI 相容」API 的更全面支援
- xAI、Microsoft Azure AI、Alibaba Cloud Qwen、IBM Watsonx、Together AI、DeepInfra、Fireworks AI、Cohere、Perplexity AI、FriendliAI、Replicate
- 強化對 Ollama 與 LM Studio 的支援

### 模型支援

我們希望 Roo 能在更多模型上順暢運作，包括本機模型：

- 透過自訂系統提示與工作流程支援本機模型
- 基準測試評估與測試案例

### 系統支援

我們希望 Roo 能在每個人的電腦上順暢運作：

- 跨平台終端機整合
- 為 Mac、Windows 與 Linux 提供穩定且一致的支援

### 文件

我們希望為所有使用者與貢獻者提供完整且易於取得的文件：

- 擴充使用者指南與教學
- 清晰的 API 文件
- 更完善的貢獻者指引
- 多語言文件資源
- 互動式範例與程式碼範例

### 穩定性

我們希望顯著降低錯誤數量並增加自動化測試：

- 除錯記錄開關
- 用於傳送錯誤／支援請求的「機器／工作資訊」複製按鈕

### 國際化

我們希望 Roo 能說每個人的語言：

- 我們希望 Roo Code 說每個人的語言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

我們特別歡迎推動藍圖目標的貢獻。如果您的貢獻符合這些核心支柱，請在 PR 描述中提及。

## 開發環境設定

1. **複製**儲存庫：

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **安裝相依套件**：

```sh
npm run install:all
```

3. **啟動網頁檢視（Vite/React 應用程式，支援 HMR）**：

```sh
npm run dev
```

4. **除錯**：
   在 VSCode 中按下 `F5`（或選擇**執行** → **開始除錯**）以開啟載入 Roo Code 的新工作階段。

網頁檢視的變更會立即顯示。核心擴充功能的變更則需要重新啟動擴充主機。

或者，您也可以建置 .vsix 檔案並直接在 VSCode 中安裝：

```sh
npm run build
```

建置完成後，`.vsix` 檔案會出現在 `bin/` 目錄中，可使用以下指令安裝：

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

## 撰寫與提交程式碼

任何人都能為 Roo Code 貢獻程式碼，但請遵守以下準則，確保您的貢獻能順利整合：

1. **保持 Pull Request 聚焦**

    - 每個 PR 限制在單一功能或錯誤修正
    - 將較大的變更拆分成較小且相關的 PR
    - 將變更拆分成可獨立審查的邏輯提交

2. **程式碼品質**

    - 所有 PR 必須通過包含程式碼檢查與格式化的 CI 檢查
    - 提交前解決所有 ESLint 警告或錯誤
    - 回應 Ellipsis（我們的自動化程式碼審查工具）的所有建議
    - 遵循 TypeScript 最佳實務並維持型別安全

3. **測試**

    - 為新功能新增測試
    - 執行 `npm test` 確保所有測試通過
    - 如果變更影響現有測試，請更新測試
    - 在適當情況下包含單元測試和整合測試

4. **提交準則**

    - 撰寫清晰、具描述性的提交訊息
    - 使用 #issue-number 在提交中引用相關議題

5. **提交前**

    - 將您的分支重新基於最新的 main
    - 確保您的分支能成功建置
    - 再次檢查所有測試是否通過
    - 檢查您的變更中是否有任何除錯程式碼或主控台記錄

6. **PR 描述**
    - 清楚描述您的變更內容
    - 包含測試變更的步驟
    - 列出任何重大變更
    - 為使用者介面變更附上截圖

## 貢獻協議

透過提交 Pull Request，您同意您的貢獻將依照與專案相同的授權條款（[Apache 2.0](../LICENSE)）進行授權。
