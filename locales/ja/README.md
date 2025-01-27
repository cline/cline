# Cline – OpenRouterでの\#1

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

Clineは、**CLI**と**エディタ**を使用できるAIアシスタントです。

[Claude 3.5 Sonnetのエージェントコーディング機能](https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf)のおかげで、Clineは複雑なソフトウェア開発タスクをステップバイステップで処理できます。ファイルの作成と編集、大規模プロジェクトの探索、ブラウザの使用、ターミナルコマンドの実行（許可後）などのツールを使用して、コード補完や技術サポートを超えた支援を提供します。Clineは、Model Context Protocol (MCP)を使用して新しいツールを作成し、自身の機能を拡張することもできます。従来の自律型AIスクリプトはサンドボックス環境で実行されますが、この拡張機能はファイル変更やターミナルコマンドを承認するための人間のインターフェースを提供し、エージェントAIの可能性を安全かつアクセスしやすい方法で探求できます。

1. タスクを入力し、モックアップを機能するアプリに変換するための画像やバグ修正のスクリーンショットを追加します。
2. Clineはファイル構造とソースコードASTを分析し、正規表現検索を実行し、関連ファイルを読み取って既存プロジェクトに精通します。コンテキストに追加される情報を慎重に管理することで、大規模で複雑なプロジェクトでもコンテキストウィンドウを圧倒することなく貴重な支援を提供できます。
3. Clineが必要な情報を取得すると、次のことができます：
        - ファイルの作成と編集 + リンター/コンパイラーエラーの監視を行い、欠落しているインポートや構文エラーなどの問題を自動的に修正します。
        - ターミナルでコマンドを直接実行し、その出力を監視しながら作業を進め、ファイル編集後の開発サーバーの問題に対応します。
        - ウェブ開発タスクでは、サイトをヘッドレスブラウザで起動し、クリック、入力、スクロール、スクリーンショットのキャプチャ + コンソールログを取得し、ランタイムエラーや視覚的なバグを修正します。
4. タスクが完了すると、Clineは`open -a "Google Chrome" index.html`のようなターミナルコマンドを提示し、ボタンをクリックして実行できます。

> [!TIP]
> `CMD/CTRL + Shift + P`ショートカットを使用してコマンドパレットを開き、「Cline: Open In New Tab」と入力して拡張機能をエディタのタブとして開きます。これにより、ファイルエクスプローラーと並行してClineを使用し、ワークスペースの変更をより明確に確認できます。

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### 任意のAPIとモデルを使用

Clineは、OpenRouter、Anthropic、OpenAI、Google Gemini、AWS Bedrock、Azure、GCP VertexなどのAPIプロバイダーをサポートしています。また、OpenAI互換のAPIを設定したり、LM Studio/Ollamaを通じてローカルモデルを使用することもできます。OpenRouterを使用している場合、拡張機能は最新のモデルリストを取得し、最新のモデルをすぐに使用できるようにします。

拡張機能は、タスクループ全体と個々のリクエストのトークン総数とAPI使用コストを追跡し、各ステップでの支出を把握できます。

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### ターミナルでコマンドを実行

VSCode v1.93の新しい[シェル統合アップデート](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api)のおかげで、Clineはターミナルでコマンドを直接実行し、出力を受け取ることができます。これにより、パッケージのインストールやビルドスクリプトの実行、アプリケーションのデプロイ、データベースの管理、テストの実行など、幅広いタスクを実行できます。Clineは、開発環境とツールチェーンに適応しながら、タスクを正確に完了します。

開発サーバーのような長時間実行されるプロセスの場合、「実行中に続行」ボタンを使用して、コマンドがバックグラウンドで実行されている間にClineがタスクを続行できるようにします。Clineが作業を進める中で、新しいターミナル出力が通知され、ファイル編集時のコンパイルエラーなどの問題に対応できます。

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### ファイルの作成と編集

Clineはエディタ内でファイルを作成および編集し、変更の差分ビューを提示します。差分ビューエディタでClineの変更を編集または元に戻すことができ、チャットでフィードバックを提供して満足するまで調整できます。Clineはリンター/コンパイラーエラー（欠落しているインポート、構文エラーなど）も監視し、発生した問題を自動的に修正します。

Clineによるすべての変更はファイルのタイムラインに記録され、必要に応じて変更を追跡および元に戻すための簡単な方法を提供します。

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### ブラウザの使用

Claude 3.5 Sonnetの新しい[コンピュータ使用](https://www.anthropic.com/news/3-5-models-and-computer-use)機能により、Clineはブラウザを起動し、要素をクリックし、テキストを入力し、スクロールし、各ステップでスクリーンショットとコンソールログをキャプチャできます。これにより、インタラクティブなデバッグ、エンドツーエンドテスト、さらには一般的なウェブ使用が可能になります。これにより、エラーログを手動でコピー＆ペーストすることなく、視覚的なバグやランタイムの問題を自律的に修正できます。

Clineに「アプリをテストして」と頼んでみてください。彼は`npm run dev`のようなコマンドを実行し、ローカルで実行中の開発サーバーをブラウザで起動し、一連のテストを実行してすべてが正常に動作することを確認します。[デモはこちら。](https://x.com/sdrzn/status/1850880547825823989)

<!-- 透明なピクセルで浮動画像の後に改行を作成 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### 「ツールを追加して...」

[Model Context Protocol](https://github.com/modelcontextprotocol)のおかげで、Clineはカスタムツールを通じて機能を拡張できます。[コミュニティ製サーバー](https://github.co