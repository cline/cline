# Cline

<p align="center">
    <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>VS Marketplaceでダウンロード</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>機能リクエスト</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>採用情報</strong></a>
</td>
</tbody>
</table>
</div>

Clineは、**CLI**と**エディター**を使用できるAIアシスタントです。

[Claude 4 Sonnetのエージェント的コーディング機能](https://www.anthropic.com/claude/sonnet)のおかげで、Clineは複雑なソフトウェア開発タスクをステップバイステップで処理できます。ファイルの作成と編集、大規模プロジェクトの探索、ブラウザの使用、ターミナルコマンドの実行（許可後）などのツールを使用して、コード補完や技術サポートを超えた支援を提供します。Clineは、Model Context Protocol (MCP)を使用して新しいツールを作成し、自身の機能を拡張することもできます。自律的なAIスクリプトは通常サンドボックス環境で実行されますが、この拡張機能はファイル変更やターミナルコマンドを承認するための人間インターフェースを提供し、エージェント的AIの可能性を安全かつアクセスしやすい方法で探求できます。

1. タスクを入力し、モックアップを機能するアプリに変換したり、スクリーンショットでバグを修正したりします。
2. Clineは、ファイル構造とソースコードASTの分析、正規表現検索の実行、関連ファイルの読み取りから始め、既存プロジェクトに精通します。コンテキストに追加される情報を慎重に管理することで、大規模で複雑なプロジェクトでもコンテキストウィンドウを圧倒することなく貴重な支援を提供できます。
3. Clineが必要な情報を取得すると、次のことができます：
        - ファイルの作成と編集 + リンター/コンパイラーエラーの監視を行い、欠落したインポートや構文エラーなどの問題を自動的に修正します。
        - ターミナルでコマンドを直接実行し、作業中に出力を監視します。これにより、ファイル編集後の開発サーバーの問題に対応できます。
        - ウェブ開発タスクでは、ヘッドレスブラウザでサイトを起動し、クリック、入力、スクロール、スクリーンショットとコンソールログのキャプチャを行い、ランタイムエラーや視覚的なバグを修正します。
4. タスクが完了すると、Clineは`open -a "Google Chrome" index.html`のようなターミナルコマンドを提示し、ボタンをクリックして実行できます。

> [!TIP]
> `CMD/CTRL + Shift + P`ショートカットを使用してコマンドパレットを開き、「Cline: Open In New Tab」と入力して、エディターのタブとして拡張機能を開きます。これにより、ファイルエクスプローラーと並行してClineを使用し、ワークスペースの変更をより明確に確認できます。

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### どのAPIやモデルでも使用可能

Clineは、OpenRouter、Anthropic、OpenAI、Google Gemini、AWS Bedrock、Azure、GCP VertexなどのAPIプロバイダーをサポートしています。また、OpenAI互換のAPIを設定したり、LM Studio/Ollamaを通じてローカルモデルを使用することもできます。OpenRouterを使用している場合、拡張機能は最新のモデルリストを取得し、最新のモデルをすぐに使用できるようにします。

拡張機能は、タスクループ全体と個々のリクエストのトークン総数とAPI使用コストを追跡し、各ステップで支出を把握できます。

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### ターミナルでコマンドを実行

VSCode v1.93の新しい[シェル統合アップデート](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api)のおかげで、Clineはターミナルでコマンドを直接実行し、出力を受け取ることができます。これにより、パッケージのインストールやビルドスクリプトの実行からアプリケーションのデプロイ、データベースの管理、テストの実行まで、幅広いタスクを実行できます。Clineは、開発環境とツールチェーンに適応して、タスクを正確に実行します。

開発サーバーのような長時間実行されるプロセスの場合、「実行中に続行」ボタンを使用して、コマンドがバックグラウンドで実行されている間にClineがタスクを続行できるようにします。Clineが作業を進める中で、新しいターミナル出力が通知され、ファイル編集時のコンパイルエラーなどの問題に対応できます。

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### ファイルの作成と編集

Clineはエディター内でファイルを作成および編集し、変更の差分ビューを提示します。差分ビューエディターでClineの変更を直接編集または元に戻すことができ、チャットでフィードバックを提供して満足するまで調整できます。Clineはリンター/コンパイラーエラー（欠落したインポート、構文エラーなど）も監視し、発生した問題を自動的に修正します。

Clineによるすべての変更はファイルのタイムラインに記録され、必要に応じて変更を追跡および元に戻す簡単な方法を提供します。

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### ブラウザの使用

Claude 4 Sonnetの新しい[コンピュータ使用](https://www.anthropic.com/news/3-5-models-and-computer-use)機能により、Clineはブラウザを起動し、要素をクリック、テキストを入力、スクロールし、各ステップでスクリーンショットとコンソールログをキャプチャできます。これにより、インタラクティブなデバッグ、エンドツーエンドテスト、さらには一般的なウェブ使用が可能になります。これにより、エラーログを手動でコピー＆ペーストすることなく、視覚的なバグやランタイムの問題を自律的に修正できます。

Clineに「アプリをテストして」と頼んでみてください。彼は`npm run dev`のようなコマンドを実行し、ローカルで実行中の開発サーバーをブラウザで起動し、一連のテストを実行してすべてが正常に動作することを確認します。[デモはこちら。](https://x.com/sdrzn/status/1850880547825823989)

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### 「ツールを追加して...」

[Model Context Protocol](https://github.com/modelcontextprotocol)のおかげで、Clineはカスタムツールを通じて機能を拡張できます。[コミュニティ製サーバー](https://github.com/modelcontextprotocol/servers)を使用することもできますが、Clineは代わりに特定のワークフローに合わせたツールを作成してインストールできます。「ツールを追加して」と頼むだけで、Clineは新しいMCPサーバーの作成から拡張機能へのインストールまでをすべて処理します。これらのカスタムツールはClineのツールキットの一部となり、将来のタスクで使用できるようになります。

- 「Jiraチケットを取得するツールを追加して」：チケットACを取得し、Clineに作業を依頼
- 「AWS EC2を管理するツールを追加して」：サーバーメトリクスを確認し、インスタンスをスケールアップまたはダウン
- 「最新のPagerDutyインシデントを取得するツールを追加して」：詳細を取得し、Clineにバグ修正を依頼

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### コンテキストを追加

**`@url`：** 最新のドキュメントをClineに提供したい場合に、URLを貼り付けて拡張機能が取得し、Markdownに変換します。

**`@problems`：** Clineが修正するためのワークスペースエラーと警告（「問題」パネル）を追加します。

**`@file`：** ファイルの内容を追加し、読み取りファイルを承認するAPIリクエストを節約します（+ファイルを検索して入力）。

**`@folder`：** フォルダーのファイルを一度に追加して、ワークフローをさらにスピードアップします。

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### チェックポイント：比較と復元

Clineがタスクを進める中で、拡張機能は各ステップでワークスペースのスナップショットを撮ります。「比較」ボタンを使用してスナップショットと現在のワークスペースの差分を確認し、「復元」ボタンを使用してそのポイントにロールバックできます。

たとえば、ローカルウェブサーバーで作業している場合、「ワークスペースのみを復元」を使用して異なるバージョンのアプリを迅速にテストし、「タスクとワークスペースを復元」を使用して続行したいバージョンを見つけたときに使用します。これにより、進行状況を失うことなく異なるアプローチを安全に探求できます。

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 貢献

プロジェクトに貢献するには、[貢献ガイド](CONTRIBUTING.md)から基本を学び始めてください。また、[Discord](https://discord.gg/cline)に参加して、`#contributors`チャンネルで他の貢献者とチャットすることもできます。フルタイムの仕事を探している場合は、[採用ページ](https://cline.bot/join-us)でオープンポジションを確認してください。

<details>
<summary>ローカル開発の手順</summary>

1. リポジトリをクローンします _(Requires [git-lfs](https://git-lfs.com/))_：
        ```bash
        git clone https://github.com/cline/cline.git
        ```
2. プロジェクトをVSCodeで開きます：
        ```bash
        code cline
        ```
3. 拡張機能とwebview-guiの必要な依存関係をインストールします：
        ```bash
        npm run install:all
        ```
4. `F5`を押して（または`Run`->`Start Debugging`）、拡張機能が読み込まれた新しいVSCodeウィンドウを開きます。（プロジェクトのビルドに問題がある場合は、[esbuild problem matchers extension](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers)をインストールする必要があるかもしれません。）

</details>

## ライセンス

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
