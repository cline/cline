# Clineの開始 | 新しいコーダー向け

Clineへようこそ！このガイドは、セットアップを行い、最初のプロジェクトを構築するためにClineを使用する方法を説明します。

## 必要なもの

始める前に、以下のものが揃っていることを確認してください：

-   **VS Code:** 無料で強力なコードエディター。
    -   [VS Codeのダウンロード](https://code.visualstudio.com/)
-   **開発ツール:** コーディングに必要なソフトウェア（Homebrew、Node.js、Gitなど）。
    -   [必須開発ツールのインストール](installing-dev-essentials.md)ガイドに従って、これらをClineの助けを借りてセットアップしてください（ここでのセットアップ後）
    -   Clineが必要なすべてのインストールをガイドします
-   **Clineプロジェクトフォルダー:** あなたのすべてのClineプロジェクトのための専用フォルダー。
    -   macOSの場合：Documentsフォルダーに「Cline」という名前のフォルダーを作成します
        -   パス：`/Users/[your-username]/Documents/Cline`
    -   Windowsの場合：Documentsフォルダーに「Cline」という名前のフォルダーを作成します
        -   パス：`C:\Users\[your-username]\Documents\Cline`
    -   このClineフォルダーの中に、各プロジェクトごとに別々のフォルダーを作成します
        -   例：`Documents/Cline/workout-app` ワークアウト追跡アプリ用
        -   例：`Documents/Cline/portfolio-website` ポートフォリオ用
-   **VS CodeのCline拡張機能:** VS CodeにインストールされたCline拡張機能。

-   開始に必要なすべてのものに関する[チュートリアル](https://www.youtube.com/watch?v=N4td-fKhsOQ)があります。

## ステップバイステップのセットアップ

Clineを起動して実行するために、以下のステップに従ってください：

1. **VS Codeを開く:** VS Codeアプリケーションを起動します。VS Codeが「Running extensions might...」と表示する場合は、「Allow」をクリックしてください。

2. **Clineフォルダーを開く:** VS Codeで、Documentsに作成したClineフォルダーを開きます。

3. **拡張機能に移動:** VS Codeのサイドにあるアクティビティバーの拡張機能アイコンをクリックします。

4. **「Cline」を検索:** 拡張機能の検索バーに「Cline」と入力します。

5. **拡張機能をインストール:** Cline拡張機能の横にある「Install」ボタンをクリックします。

6. **Clineを開く:** インストール後、Clineを開く方法はいくつかあります：
    - アクティビティバーのClineアイコンをクリックします。
    - コマンドパレット（`CMD/CTRL + Shift + P`）を使用し、「Cline: Open In New Tab」と入力して、エディター内のタブとしてClineを開きます。これはより良いビューが得られるため推奨されます。
    - **トラブルシューティング:** Clineアイコンが表示されない場合は、VS Codeを再起動してみてください。
    - **見えるもの:** VS Codeエディター内にClineのチャットウィンドウが表示されるはずです。

![gettingStartedVsCodeCline](https://github.com/user-attachments/assets/622b4bb7-859b-4c2e-b87b-c12e3eabefb8)

## OpenRouter APIキーの設定

Clineがインストールされたので、Clineの全機能を利用するためにOpenRouter APIキーを設定する必要があります。
1.  **OpenRouter APIキーの取得:**
    -   [OpenRouter APIキーの取得](https://openrouter.ai/)
2.  **OpenRouter APIキーの入力:**
    -   Cline拡張機能の設定ボタンに移動します。
    -   OpenRouter APIキーを入力します。
    -   好みのAPIモデルを選択します。
        -   **コーディングに推奨されるモデル:**
            -   `anthropic/claude-3.5-sonnet`: コーディングタスクに最も使用される。
            -   `google/gemini-2.0-flash-exp:free`: コーディングのための無料オプション。
            -   `deepseek/deepseek-chat`: 非常に安価で、3.5 sonnetにほぼ匹敵する。
        -   [OpenRouterモデルのランキング](https://openrouter.ai/rankings/programming)

## Clineとの最初のインタラクション

これでClineを使って構築を開始する準備が整いました。最初のプロジェクトフォルダを作成し、何かを作りましょう！以下のプロンプトをClineのチャットウィンドウにコピーして貼り付けます：

```
Hey Cline! Could you help me create a new project folder called "hello-world" in my Cline directory and make a simple webpage that says "Hello World" in big blue text?
```

**見るもの:** Clineはプロジェクトフォルダの作成と最初のウェブページの設定を手伝ってくれます。

## Clineと協力するためのヒント

-   **質問をする:** 何かわからないことがあれば、Clineに遠慮なく質問してください！
-   **スクリーンショットを使用する:** Clineは画像を理解できるので、作業中の内容をスクリーンショットで示すことができます。
-   **エラーのコピー＆ペースト:** エラーに遭遇した場合は、エラーメッセージをClineのチャットにコピー＆ペーストしてください。これにより、問題を理解し、解決策を提供するのに役立ちます。
-   **平易な言葉で話す:** Clineは平易で非技術的な言葉を理解するように設計されています。自分の言葉でアイデアを説明して、Clineがそれをコードに変換するのを自由にしてください。

## FAQ

-   **ターミナルとは何ですか？** ターミナルは、コンピュータと対話するためのテキストベースのインターフェースです。パッケージのインストール、スクリプトの実行、ファイルの管理など、さまざまなタスクを実行するためのコマンドを実行できます。Clineはターミナルを使用してコマンドを実行し、開発環境と対話します。
-   **コードベースの仕組みは？** （新しいコーダーからの一般的な質問に基づいて、このセクションは拡張されます）

## まだ苦労していますか？

私に連絡して、Clineの開始を手伝ってもらってください。

nick | 608-558-2410

私たちのDiscordコミュニティに参加してください: [https://discord.gg/cline](https://discord.gg/cline)