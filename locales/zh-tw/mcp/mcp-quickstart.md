# 🚀 MCP 快速入門指南

## ❓ 什麼是 MCP 伺服器？

將 MCP 伺服器視為特殊助手，它們賦予 Cline 額外的能力！它們讓 Cline 能夠執行如獲取網頁或處理檔案等酷炫功能。

## ⚠️ 重要：系統要求

停止！在繼續之前，您必須驗證這些要求：

### 所需軟體

-   ✅ 最新版 Node.js（v18 或更新版本）

    -   檢查方法：執行 `node --version`
    -   安裝來源：<https://nodejs.org/>

-   ✅ 最新版 Python（v3.8 或更新版本）

    -   檢查方法：執行 `python --version`
    -   安裝來源：<https://python.org/>

-   ✅ UV 套件管理器
    -   安裝 Python 後，執行：`pip install uv`
    -   驗證方法：`uv --version`

❗ 如果這些命令失敗或顯示舊版本，請在繼續前安裝/更新！

⚠️ 如果遇到其他錯誤，請參閱下方的「疑難排解」部分。

## 🎯 快速步驟（僅在滿足要求後執行！）

### 1. 🛠️ 安裝您的第一個 MCP 伺服器

1. 從 Cline 擴充功能中，點擊 `MCP 伺服器` 標籤
1. 點擊 `編輯 MCP 設置` 按鈕

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="MCP 伺服器面板" width="400" />

1. MCP 設置檔案應該會在 VS Code 中顯示為一個標籤。
1. 將檔案內容替換為以下代碼：

對於 Windows：

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		}
	}
}
```

對於 Mac 和 Linux：

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "npx",
			"args": ["@anaisbetts/mcp-installer"]
		}
	}
}
```

儲存檔案後：

1. Cline 將自動偵測變更
2. MCP 安裝程序將被下載並安裝
3. Cline 將啟動 MCP 安裝程序
4. 您將在 Cline 的 MCP 設置 UI 中看到伺服器狀態：

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="帶有安裝程序的 MCP 伺服器面板" width="400" />

## 🤔 接下來呢？

現在您有了 MCP 安裝程序，您可以要求 Cline 從以下位置添加更多伺服器：

1. NPM 註冊表：<https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Python 套件索引：<https://pypi.org/search/?q=mcp+server-&o=>

例如，您可以要求 Cline 安裝在 Python 套件索引上找到的 `mcp-server-fetch` 套件：

```bash
"安裝名為 `mcp-server-fetch` 的 MCP 伺服器
- 確保 MCP 設置已更新。
- 使用 uvx 或 python 來運行伺服器。"
```

您應該會看到 Cline：

1. 安裝 `mcp-server-fetch` Python 套件
1. 更新 mcp 設置 json 檔案
1. 啟動伺服器並啟動伺服器

MCP 設置檔案現在應該看起來像這樣：

_對於 Windows 機器：_
```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		},
		"mcp-server-fetch": {
			"command": "uvx",
			"args": ["mcp-server-fetch"]
		}
	}
}
```

您隨時可以通過前往客戶端的 MCP 伺服器選項卡來檢查伺服器的狀態。請參閱上面的圖像。

就是這樣！🎉 您剛剛賦予了 Cline 一些很棒的新能力！

## 📝 疑難排解

### 1. 我使用 `asdf` 並且收到 "unknown command: npx" 的錯誤

有一些稍微不好的消息。您仍然應該能夠讓事情運作，但將需要做一些額外的工作，除非 MCP 伺服器打包有所進展。一個選項是卸載 `asdf`，但我們假設您不希望這樣做。

相反，您需要按照上面的說明來“編輯 MCP 設置”。然後，如[這篇文章](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n)所述，您需要在每個伺服器的配置中添加一個 "env" 條目。

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

`path_to_asdf_bin_dir` 通常可以在您的 shell 配置中找到（例如 `.zshrc`）。如果您使用 Homebrew，您可以使用 `echo ${HOMEBREW_PREFIX}` 來找到目錄的開始，然後附加 `/opt/asdf/libexec`。

現在有一些好消息。雖然不是完美的，但您可以讓 Cline 相當可靠地為後續的伺服器安裝執行這項工作。在 Cline 設置中（右上角工具欄按鈕）的“自定義指令”中添加以下內容：

> 當安裝 MCP 伺服器並編輯 cline_mcp_settings.json 時，如果伺服器需要使用 `npx` 作為命令，您必須從 "mcp-installer" 條目中複製 "env" 條目並將其添加到新條目中。這對於伺服器在使用時正常運作至關重要。

### 2. 當我運行 MCP 安裝程序時仍然收到錯誤

如果您在運行 MCP 安裝程序時收到錯誤，您可以嘗試以下方法：

-   檢查 MCP 設置文件是否有錯誤
-   閱讀 MCP 伺服器的文檔，以確保 MCP 設置文件使用正確的命令和參數。👈
-   使用終端直接運行命令及其參數。這將允許您看到與 Cline 相同的錯誤。