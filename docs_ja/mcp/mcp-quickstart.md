# 🚀 MCPクイックスタートガイド

## ❓ MCPサーバーとは？

MCPサーバーは、Clineに追加の能力を与える特別なヘルパーと考えてください！これによりClineはウェブページの取得やファイル操作などのクールなことができるようになります。

## ⚠️ 重要: システム要件

ストップ！続行する前に、以下の要件を必ず確認してください：

### 必須ソフトウェア

-   ✅ 最新のNode.js（v18以降）

    -   確認方法: `node --version`を実行
    -   インストール先: <https://nodejs.org/>

-   ✅ 最新のPython（v3.8以降）

    -   確認方法: `python --version`を実行
    -   インストール先: <https://python.org/>

-   ✅ UVパッケージマネージャー
    -   Pythonインストール後、実行: `pip install uv`
    -   確認方法: `uv --version`

❗ これらのコマンドのいずれかが失敗したり、古いバージョンが表示される場合は、続行する前にインストール/更新してください！

⚠️ 他のエラーが発生した場合は、下記の「トラブルシューティング」セクションを参照してください。

## 🎯 クイックステップ（要件を満たした後のみ！）

### 1. 🛠️ 最初のMCPサーバーをインストールする

1. Cline拡張機能から、`MCPサーバー`タブをクリックします
1. `MCPの設定を編集`ボタンをクリックします

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="MCP Server Panel" width="400" />

1. MCP設定ファイルがVS Codeのタブに表示されるはずです。
1. ファイルの内容を以下のコードに置き換えます：

Windows用：

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

Mac及びLinux用：

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

ファイルを保存した後：

1. Clineは自動的に変更を検出します
2. MCPインストーラーがダウンロードされインストールされます
3. ClineはMCPインストーラーを起動します
4. ClineのMCP設定UIでサーバーステータスを確認できます：

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="MCP Server Panel with Installer" width="400" />

## 🤔 次は何をすればいい？

MCPインストーラーができたので、以下からさらにサーバーを追加するようClineに依頼できます：

1. NPMレジストリ: <https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Python Package Index: <https://pypi.org/search/?q=mcp+server-&o=>

例えば、Python Package Indexにある`mcp-server-fetch`パッケージをインストールするようClineに依頼できます：

```bash
"MCPサーバー名「mcp-server-fetch」をインストールしてください
- mcp設定が更新されたことを確認してください。
- サーバーを実行するにはuvxまたはpythonを使用してください。"
```

Clineが以下を行うのを確認できるはずです：

1. `mcp-server-fetch` pythonパッケージをインストールする
1. mcp設定jsonファイルを更新する
1. サーバーを起動して、サーバーを開始する

mcp設定ファイルは現在このようになっているはずです：

_Windowsマシンの場合：_

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

クライアントのMCPサーバータブに移動して、いつでもサーバーのステータスを確認できます。上の画像を参照してください。

以上です！🎉 これでClineにいくつかの素晴らしい新機能を追加できました！

## 📝 トラブルシューティング

### 1. `asdf`を使用していて「unknown command: npx」が出る場合

少し悪いニュースがあります。まだ動作させることはできるはずですが、MCPサーバーのパッケージングが少し進化しない限り、もう少し手動の作業が必要になります。一つの選択肢は`asdf`をアンインストールすることですが、それを望まないと仮定します。

代わりに、上記の「MCPの設定を編集」の指示に従ってください。次に、[この投稿](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n)で説明されているように、各サーバー設定に「env」エントリを追加する必要があります。

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

`path_to_asdf_bin_dir`は、多くの場合、シェル設定（例：`.zshrc`）で見つけることができます。Homebrewを使用している場合は、`echo ${HOMEBREW_PREFIX}`を使用してディレクトリの開始位置を見つけ、`/opt/asdf/libexec`を追加します。

良いニュースもあります。完璧ではありませんが、後続のサーバーインストールに対してClineにこれを確実に行わせることができます。Cline設定（右上のツールバーボタン）の「カスタム指示」に以下を追加してください：

> MCPサーバーをインストールしてcline_mcp_settings.jsonを編集する際、サーバーが`npx`をコマンドとして使用する必要がある場合は、「mcp-installer」エントリから「env」エントリをコピーして、新しいエントリに追加する必要があります。これは、使用時にサーバーを適切に機能させるために不可欠です。

### 2. MCPインストーラーを実行してもまだエラーが出る場合

MCPインストーラーを実行してエラーが発生する場合は、以下を試してください：

-   MCP設定ファイルにエラーがないか確認する
-   MCP設定ファイルが正しいコマンドと引数を使用していることを確認するため、MCPサーバーのドキュメントを読む 👈
-   ターミナルを使用して、コマンドとその引数を直接実行する。これにより、Clineが見ているのと同じエラーを確認できます。
