# 🚀 MCP クイックスタートガイド

## ❓ MCPサーバーとは何ですか？

MCPサーバーは、Clineに特別な力を与える助け手だと考えてください！これにより、Clineはウェブページの取得やファイルの操作など、クールなことができます。

## ⚠️ 重要：システム要件

STOP！進める前に、これらの要件を確認する必要があります：

### 必要なソフトウェア

-   ✅ 最新のNode.js（v18以降）

    -   確認方法：`node --version` を実行
    -   インストール先：<https://nodejs.org/>

-   ✅ 最新のPython（v3.8以降）

    -   確認方法：`python --version` を実行
    -   インストール先：<https://python.org/>

-   ✅ UVパッケージマネージャー
    -   Pythonをインストールした後、`pip install uv` を実行
    -   確認方法：`uv --version` を実行

❗ これらのコマンドが失敗するか、古いバージョンが表示される場合は、続行する前にインストール/更新してください！

⚠️ その他のエラーが発生した場合は、下記の「トラブルシューティング」セクションを参照してください。

## 🎯 クイックステップ（要件が満たされた後のみ！）

### 1. 🛠️ 最初のMCPサーバーをインストールする

1. Cline拡張機能から、`MCP Server`タブをクリック
1. `Edit MCP Settings`ボタンをクリック

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="MCP Server Panel" width="400" />

1. MCP設定ファイルがVS Codeのタブに表示されるはずです。
1. ファイルの内容を以下のコードに置き換えます：

Windowsの場合：

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

MacおよびLinuxの場合：

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

1. Clineが自動的に変更を検出します
2. MCPインストーラーがダウンロードされ、インストールされます
3. ClineがMCPインストーラーを起動します
4. ClineのMCP設定UIでサーバーのステータスが表示されます：

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="MCP Server Panel with Installer" width="400" />

## 🤔 次は何をしますか？

MCPインストーラーが手に入ったので、Clineに以下の場所からさらにサーバーを追加するよう依頼できます：

1. NPMレジストリ：<https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Pythonパッケージインデックス：<https://pypi.org/search/?q=mcp+server-&o=>

例えば、Pythonパッケージインデックスで見つけた`mcp-server-fetch`パッケージをClineにインストールさせることができます：

```bash
"名前が `mcp-server-fetch` のMCPサーバーをインストールしてください
- MCP設定が更新されていることを確認してください。
- サーバーを実行するためにuvxまたはpythonを使用してください。"
```

Clineが以下のように動作するのを目撃するはずです：

1. `mcp-server-fetch` Pythonパッケージをインストール
1. mcp設定のJSONファイルを更新
1. サーバーを起動し、サーバーを開始

mcp設定ファイルは今こう見えるはずです：

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

MCPサーバーの状態を確認するには、クライアントのMCPサーバータブにアクセスしてください。上記の画像を参照してください。

これで完了です！🎉 素晴らしい新機能をClineに追加しました！

## 📝 トラブルシューティング

### 1. `asdf`を使用していて「unknown command: npx」というエラーが出る

少し残念なお知らせがあります。まだ動作させることは可能ですが、MCPサーバーのパッケージングが進化するまで、もう少し手動で作業する必要があります。一つの選択肢は`asdf`をアンインストールすることですが、ここではそれを望まないと仮定します。

代わりに、上記の「MCP設定の編集」の手順に従う必要があります。そして、[この投稿](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n)で説明されているように、各サーバーの設定に「env」エントリを追加する必要があります。

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

`path_to_asdf_bin_dir`は通常、シェルの設定ファイル（例：`.zshrc`）で見つけることができます。Homebrewを使用している場合、`echo ${HOMEBREW_PREFIX}`を使用してディレクトリの開始部分を見つけ、`/opt/asdf/libexec`を追加することができます。

良いニュースもあります。完璧ではありませんが、Clineにこれを信頼性高く行わせることができます。Clineの設定（右上ツールバーのボタン）の「カスタム指示」に以下の内容を追加してください：

> MCPサーバーをインストールし、cline_mcp_settings.jsonを編集する際、サーバーがコマンドとして`npx`を使用する場合、「mcp-installer」エントリから「env」エントリをコピーし、新しいエントリに追加する必要があります。これはサーバーが正しく動作するために非常に重要です。

### 2. MCPインストーラーを実行するとまだエラーが発生する

MCPインストーラーを実行するとエラーが発生する場合、以下の方法を試してください：

-   MCP設定ファイルにエラーがないか確認する
-   MCPサーバーのドキュメントを読み、MCP設定ファイルが正しいコマンドと引数を使用していることを確認する。👈
-   ターミナルを使用してコマンドとその引数を直接実行する。これにより、Clineが見ているのと同じエラーを見ることができます。