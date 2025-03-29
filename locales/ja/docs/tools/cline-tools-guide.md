# Clineツールリファレンスガイド

## Clineは何ができるの？

Clineは次のことができるAIアシスタントです：

-   プロジェクト内でファイルを編集・作成する
-   ターミナルコマンドを実行する
-   コードを検索・分析する
-   デバッグと問題の修正を支援する
-   繰り返し作業を自動化する
-   外部ツールと統合する

## 最初の一歩

1. **タスクを開始する**

    - チャットにリクエストを入力する
    - 例："Headerという新しいReactコンポーネントを作成する"

2. **コンテキストを提供する**

    - ファイル、フォルダ、またはURLを@メンションで追加する
    - 例："@file:src/components/App.tsx"

3. **変更を確認する**
    - Clineは変更を行う前に差分を表示します
    - 変更を編集または拒否できます

## 主要機能

1. **ファイル編集**

    - 新しいファイルを作成する
    - 既存のコードを変更する
    - ファイル全体にわたって検索と置換を行う

2. **ターミナルコマンド**

    - npmコマンドを実行する
    - 開発サーバーを起動する
    - 依存関係をインストールする

3. **コード分析**

    - エラーを見つけて修正する
    - コードをリファクタリングする
    - ドキュメントを追加する

4. **ブラウザ統合**
    - ウェブページをテストする
    - スクリーンショットをキャプチャする
    - コンソールログを検査する

## 利用可能なツール

最新の実装詳細については、[Clineリポジトリ](https://github.com/cline/cline/blob/main/src/core/Cline.ts)で完全なソースコードを閲覧できます。

Clineは以下のツールを使用してさまざまなタスクを実行できます：

1. **ファイル操作**

    - `write_to_file`: ファイルを作成または上書きする
    - `read_file`: ファイルの内容を読み取る
    - `replace_in_file`: ファイルに対してターゲットを絞った編集を行う
    - `search_files`: 正規表現を使用してファイルを検索する
    - `list_files`: ディレクトリの内容をリストアップする

2. **ターミナル操作**

    - `execute_command`: CLIコマンドを実行する
    - `list_code_definition_names`: コード定義をリストアップする

3. **MCPツール**

    - `use_mcp_tool`: MCPサーバーからツールを使用する
    - `access_mcp_resource`: MCPサーバーのリソースにアクセスする
    - ユーザーはClineがアクセスできるカスタムMCPツールを作成できます
    - 例：Clineが予報を取得するために使用できる天気APIツールを作成する

4. **インタラクションツール**
    - `ask_followup_question`: ユーザーに確認を求める
    - `attempt_completion`: 最終結果を提示する

各ツールには特定のパラメータと使用パターンがあります。以下にいくつかの例を示します：

-   新しいファイルを作成する（write_to_file）:

    ```xml
    <write_to_file>
    <path>src/components/Header.tsx</path>
    <content>
    // Headerコンポーネントのコード
    </content>
    </write_to_file>
    ```

-   パターンを検索する（search_files）:

    ```xml
    <search_files>
    <path>src</path>
    <regex>function\s+\w+\(</regex>
    <file_pattern>*.ts</file_pattern>
    </search_files>
    ```

-   コマンドを実行する（execute_command）:
    ```xml
    <execute_command>
    <command>npm install axios</command>
    <requires_approval>false</requires_approval>
    </execute_command>
    ```

## 一般的なタスク

1. **新しいコンポーネントを作成する**

    - "Footerという新しいReactコンポーネントを作成する"

2. **バグを修正する**

    - "src/utils/format.tsのエラーを修正する"

3. **コードをリファクタリングする**

    - "ButtonコンポーネントをTypeScriptを使用するようにリファクタリングする"

4. **コマンドを実行する**
    - "axiosを追加するためにnpm installを実行する"

## ヘルプを受ける

-   [Discordコミュニティに参加する](https://discord.gg/cline)
-   ドキュメントを確認する
-   Clineの改善のためのフィードバックを提供する