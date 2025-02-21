<div align="center"><sub>
英語 | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">スペイン語</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">ドイツ語</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">簡体字中国語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">繁体字中国語</a>
</sub></div>

# Cline: 真剣なエンジニアリング作業のための協働AIパートナー

完全な協働AIパートナーでエンジニアリングチームを変革しましょう。オープンソースで、完全に拡張可能、そして開発者の影響力を高めるために設計されています。

<p align="center">
  <video alt="協働開発機能を紹介するCline AIエージェントのデモ" autoplay loop muted playsinline width="100%">
    <source src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demoForWebsiteNew.mp4" type="video/mp4">
  </video>
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>VS Marketplaceからダウンロード</strong></a>
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
<a href="https://docs.cline.bot/getting-started/getting-started-new-coders" target="_blank"><strong>はじめに</strong></a>
</td>
</tbody>
</table>
</div>

Clineは単なる自律エージェントではなく、開発ワークフローを効率化するあなたのAIパートナーです。行動を起こす前にあなたと一緒に計画を立て、その考え方を説明し、複雑なタスクを段階的に分解します。ファイルの作成・編集、プロジェクトの探索、コマンドの実行などのツールを活用し、端末やファイル、エラーログに至るまで環境全体を監視して、円滑な進行をサポートします。

従来のAIスクリプトがサンドボックス環境で動作するのに対し、Clineはヒューマン・イン・ザ・ループのGUIを提供し、すべてのファイル変更や端末コマンドの承認を可能にします。さらに、MCP（Model Context Protocol）との統合により、外部データベースやライブドキュメントにもアクセスし、自動的に問題を検出して修正を適用するため、あなたはイノベーションに集中できます。エンタープライズレベルのセキュリティを考慮して設計されており、AWS Bedrock、GCP Vertex、Azureのエンドポイントを介して最先端のモデルにアクセスしながら、コードの安全性を確保します。

1. タスクを入力し、画像を追加してモックアップを機能するアプリに変換するか、スクリーンショットを使用してバグを修正します。
2. Clineは、ファイル構造とソースコードのASTを解析し、正規表現検索を実行、関連ファイルを読み込むことで既存プロジェクトに迅速に対応します。文脈に追加する情報を慎重に管理することで、大規模かつ複雑なプロジェクトでもコンテキストウィンドウを圧迫することなく有用な支援を提供できます。
3. 必要な情報を取得すると、Clineは以下のことが可能です:
    - ファイルを作成・編集し、リンターやコンパイラのエラーを監視することで、インポート不足や構文エラーなどの問題を自律的に修正します。
    - 端末で直接コマンドを実行し、その出力を監視することで、ファイル編集後の開発サーバーの問題に対応します。
    - ウェブ開発タスクでは、ヘッドレスブラウザでサイトを起動し、クリック、入力、スクロールを行い、スクリーンショットやコンソールログを取得することで、ランタイムエラーや視覚的な不具合を修正します。
4. タスクが完了すると、Clineは `open -a "Google Chrome" index.html` のような端末コマンドで結果を提示し、ワンクリックで実行できるようにします。

> [!TIP]
> `CMD/CTRL + Shift + P` のショートカットを使ってコマンドパレットを開き、「Cline: Open In New Tab」と入力することで、エディタ内の新しいタブで拡張機能を開くことができます。これにより、ファイルエクスプローラーと並んでClineを使用し、作業スペースの変化をより明確に確認できます。

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4" alt="Clineの柔軟なモデル統合インターフェイス">

### 任意のAPIとモデルを利用する

Clineは、OpenRouter、Anthropic、OpenAI、Google Gemini、AWS Bedrock、Azure、GCP VertexなどのAPIプロバイダーに対応しています。OpenAI互換の任意のAPIを設定することも、LM StudioやOllamaを通じてローカルモデルを使用することも可能です。OpenRouterを利用している場合、拡張機能は最新のモデルリストを取得し、利用可能な最新モデルをすぐに使用できるようにします。

拡張機能は、タスク全体および個々のリクエストに対する総トークン数とAPI使用コストも追跡し、各ステップでの支出状況を把握できるようにします。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76" alt="Clineの端末コマンド実行インターフェイス">

### 端末でコマンドを実行する

VSCode v1.93の新しいシェル統合アップデートにより、Clineは端末で直接コマンドを実行し、その出力を監視できます。これにより、パッケージのインストールやビルドスクリプトの実行、アプリケーションの展開、データベースの管理、テストの実行など、幅広いタスクをあなたの開発環境やツールチェーンに合わせて正確に行うことが可能です。

長時間実行されるプロセス（例：開発サーバー）の場合は、「実行中に続行」ボタンを使用して、コマンドがバックグラウンドで動作している間もタスクを継続できます。作業中に新たな端末出力が発生すると、Clineはその情報を受け取り、ファイル編集時のコンパイルエラーなどの問題に迅速に対応できます。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588" alt="Clineの差分表示付きファイル編集インターフェイス">

### ファイルの作成と編集

Clineはエディタ内で直接ファイルを作成・編集し、変更点の差分（diff）ビューを表示します。差分ビュー上で直接Clineの変更を編集または元に戻すことができ、チャットでフィードバックを提供して結果に満足するまでやり取りが可能です。さらに、Clineはリンターやコンパイラのエラー（インポート不足、構文エラーなど）を監視し、自律的に問題を修正します。

Clineが行ったすべての変更は、ファイルのタイムラインに記録され、必要に応じて変更を追跡・元に戻すことが容易になります。

<!-- Transparent pixel to create line break after floating image -->

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5" alt="Clineのブラウザ自動化インターフェイス">

### ブラウザを使用する

Claude 3.5 Sonnetの新しい「コンピュータ利用」機能により、Clineはブラウザを起動して要素をクリック、テキスト入力、スクロールを行い、各ステップでスクリーンショットやコンソールログを取得できます。これにより、インタラクティブなデバッグ、エンドツーエンドのテスト、さらには一般的なウェブ利用が可能となり、エラーログを手動でコピー＆ペーストすることなく、視覚的なバグやランタイムの問題を自律的に修正できます。

「アプリをテストして」とClineに指示してみると、`npm run dev` のようなコマンドを実行し、ローカルで稼働している開発サーバーをブラウザで起動し、一連のテストを実施してすべてが正しく動作するか確認する様子が見られます。 [デモを見る](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd" alt="ClineのMCPツール作成インターフェイス">

### 「ツールを追加して…」

Model Context Protocolのおかげで、Clineはカスタムツールを通じて機能を拡張できます。コミュニティ製サーバーを利用することもできますが、Clineはあなたのワークフローに合わせたツールを自ら作成・インストールすることも可能です。単に「ツールを追加して」と指示すれば、新しいMCPサーバーの作成から拡張機能へのインストールまで、すべてを自動で処理します。これらのカスタムツールはClineのツールキットの一部となり、今後のタスクで利用可能です。

- 「Jiraチケットを取得するツールを追加して」：Jiraのチケットコードを取得し、Clineを稼働させます。
- 「AWS EC2を管理するツールを追加して」：サーバーのメトリクスを監視し、インスタンスのスケールアップやスケールダウンを実施します。
- 「最新のPagerDutyインシデントを取得するツールを追加して」：詳細情報を取得し、Clineにバグ修正を依頼します。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970" alt="Clineのコンテキスト管理インターフェイス">

### コンテキストを追加する

**`@url`:** 拡張機能が取得してMarkdownに変換するためのURLを貼り付けます。最新のドキュメントをClineに提供する際に便利です。

**`@problems`:** Clineが修正すべきワークスペースのエラーや警告（Problemsパネル）を追加します。

**`@file`:** ファイルの内容を追加して、読み取り承認のためのAPIリクエストを節約します。（ファイル検索も可能です）

**`@folder`:** フォルダ内のファイルを一括で追加し、ワークフローをさらに迅速化します。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb" alt="Clineのチェックポイント比較インターフェイス">

### エンタープライズ向けセキュリティ

Clineがタスクを進める際、拡張機能は各ステップであなたのワークスペースのスナップショットを取得します。『比較』ボタンを使ってスナップショットと現在のワークスペースとの差分を確認し、『復元』ボタンでその状態に戻すことができます。

例えば、ローカルウェブサーバーで作業する場合、『ワークスペースのみ復元』を使ってアプリの異なるバージョンを迅速にテストし、最終的に継続するバージョンが決まったら『タスクとワークスペースの復元』を実行できます。これにより、進捗を失うことなく様々なアプローチを安全に試すことが可能です。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 貢献

プロジェクトに貢献するには、まず[Contributing Guide](CONTRIBUTING.md)で基本を学んでください。また、[Discord](https://discord.gg/cline)に参加して、`#contributors`チャンネルで他の貢献者と交流することもできます。フルタイムの仕事をお探しの場合は、[キャリアページ](https://cline.bot/join-us)で募集情報をご確認ください。

<details>
<summary>ローカル開発手順</summary>

1. リポジトリをクローンします _(git-lfsが必要)_:
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. VSCodeでプロジェクトを開きます:
    ```bash
    code cline
    ```
3. 拡張機能とWebview-GUIの必要な依存関係をインストールします:
    ```bash
    npm run install:all
    ```
4. `F5`キー（または「実行」→「デバッグの開始」）を押して、拡張機能が読み込まれた新しいVSCodeウィンドウを開きます。（プロジェクトのビルドで問題が発生した場合は、[esbuild problem matchers extension](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers)をインストールしてください。）

</details>

<details>
<summary>Pull Requestの作成</summary>

1. PRを作成する前に、changesetエントリを生成します:
    ```bash
    npm run changeset
    ```
   これにより、以下の情報が求められます:
   - 変更の種類（メジャー、マイナー、パッチ）
     - `メジャー` → 破壊的変更 (1.0.0 → 2.0.0)
     - `マイナー` → 新機能追加 (1.0.0 → 1.1.0)
     - `パッチ` → バグ修正 (1.0.0 → 1.0.1)
   - 変更内容の説明

2. 変更内容と生成された `.changeset` ファイルをコミットします

3. ブランチをプッシュし、GitHub上でPRを作成します。CIは以下を実行します:
   - テストとチェックの実行
   - Changesetbotがバージョンへの影響を示すコメントを作成
   - Mainブランチへのマージ後、Changesetbotがバージョンパッケージ用のPRを作成
   - バージョンパッケージPRがマージされると、新しいリリースが公開されます

</details>

## ライセンス

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
