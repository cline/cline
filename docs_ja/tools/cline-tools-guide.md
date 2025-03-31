# Clineツールリファレンスガイド

## Clineにできること

ClineはあなたのAIアシスタントで、以下のことができます：

-   プロジェクト内のファイルを編集・作成する
-   ターミナルコマンドを実行する
-   コードを検索・分析する
-   デバッグと問題修正を支援する
-   繰り返しのタスクを自動化する
-   外部ツールと統合する

## 最初のステップ

1. **タスクを開始する**

    - チャットにリクエストを入力する
    - 例：「Headerという名前の新しいReactコンポーネントを作成する」

2. **コンテキストを提供する**

    - @メンションを使用してファイル、フォルダ、URLを追加する
    - 例：「@file:src/components/App.tsx」

3. **変更を確認する**
    - Clineは変更を加える前に差分を表示します
    - 変更を編集または拒否できます

## 主な機能

1. **ファイル編集**

    - 新しいファイルの作成
    - 既存のコードの修正
    - ファイル間での検索と置換

2. **ターミナルコマンド**

    - npmコマンドの実行
    - 開発サーバーの起動
    - 依存関係のインストール

3. **コード分析**

    - エラーの発見と修正
    - コードのリファクタリング
    - ドキュメントの追加

4. **ブラウザ統合**
    - ウェブページのテスト
    - スクリーンショットの取得
    - コンソールログの確認

## 利用可能なツール

最新の実装詳細については、[Clineリポジトリ](https://github.com/cline/cline/blob/main/src/core/Cline.ts)のフルソースコードを確認できます。

Clineは様々なタスクに対して以下のツールにアクセスできます：

1. **ファイル操作**

    - `write_to_file`：ファイルの作成または上書き
    - `read_file`：ファイル内容の読み取り
    - `replace_in_file`：ファイルの特定部分を編集
    - `search_files`：正規表現を使用したファイル検索
    - `list_files`：ディレクトリの内容を一覧表示

2. **ターミナル操作**

    - `execute_command`：CLIコマンドの実行
    - `list_code_definition_names`：コード定義の一覧表示

3. **MCPツール**

    - `use_mcp_tool`：MCPサーバーからのツールを使用
    - `access_mcp_resource`：MCPサーバーリソースにアクセス
    - ユーザーはClineがアクセスできるカスタムMCPツールを作成可能
    - 例：Clineが天気予報を取得できる天気APIツールの作成

4. **対話ツール**
    - `ask_followup_question`：ユーザーに明確化を求める
    - `attempt_completion`：最終結果を提示する

各ツールには特定のパラメータと使用パターンがあります。以下はいくつかの例です：

-   新しいファイルの作成（write_to_file）：

    ```xml
    <write_to_file>
    <path>src/components/Header.tsx</path>
    <content>
    // Headerコンポーネントのコード
    </content>
    </write_to_file>
    ```

-   パターンの検索（search_files）：

    ```xml
    <search_files>
    <path>src</path>
    <regex>function\s+\w+\(</regex>
    <file_pattern>*.ts</file_pattern>
    </search_files>
    ```

-   コマンドの実行（execute_command）：
    ```xml
    <execute_command>
    <command>npm install axios</command>
    <requires_approval>false</requires_approval>
    </execute_command>
    ```

## 一般的なタスク

1. **新しいコンポーネントの作成**

    - 「Footerという名前の新しいReactコンポーネントを作成してください」

2. **バグの修正**

    - 「src/utils/format.tsのエラーを修正してください」

3. **コードのリファクタリング**

    - 「ButtonコンポーネントをTypeScriptを使用するようにリファクタリングしてください」

4. **コマンドの実行**
    - 「axiosを追加するためにnpm installを実行してください」

## ヘルプの取得

-   [Discordコミュニティに参加する](https://discord.gg/cline)
-   ドキュメントを確認する
-   Clineを改善するためにフィードバックを提供する
