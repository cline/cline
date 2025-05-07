[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

<b>日本語</b> • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Roo Code への貢献

Roo Code はコミュニティ主導のプロジェクトであり、すべての貢献を大切にしています。みんながスムーズかつ効果的に参加できるように、**「[Issue-First](#2-重要な原則-issue-firstアプローチ)」方式で運営しています。** つまり、すべての作業は Pull Request を出す _前に_ GitHub Issue に紐付ける必要があります（詳細は[PRポリシー](#pull-request-pr-ポリシー)を参照）。このガイドをよく読んで、貢献方法を理解してください。
このガイドは、バグ修正、新機能追加、ドキュメント改善など、Roo Code への貢献方法を説明します。

## 目次

- [I. 貢献する前に](#i-貢献する前に)
    - [1. 行動規範](#1-行動規範)
    - [2. プロジェクトロードマップの理解](#2-プロジェクトロードマップの理解)
        - [プロバイダーサポート](#プロバイダーサポート)
        - [モデルサポート](#モデルサポート)
        - [システムサポート](#システムサポート)
        - [ドキュメント](#ドキュメント)
        - [安定性](#安定性)
        - [国際化](#国際化)
    - [3. Roo Code コミュニティに参加する](#3-roo-code-コミュニティに参加する)
- [II. 貢献内容の発見と計画](#ii-貢献内容の発見と計画)
    - [1. 貢献の種類](#1-貢献の種類)
    - [2. 重要な原則: Issue-First アプローチ](#2-重要な原則-issue-first-アプローチ)
    - [3. 何に取り組むか決める](#3-何に取り組むか決める)
    - [4. バグや問題の報告](#4-バグや問題の報告)
- [III. 開発と提出のプロセス](#iii-開発と提出のプロセス)
    - [1. 開発環境のセットアップ](#1-開発環境のセットアップ)
    - [2. コーディングガイドライン](#2-コーディングガイドライン)
    - [3. コード提出: Pull Request (PR) プロセス](#3-コード提出-pull-request-pr-プロセス)
        - [ドラフト Pull Request](#ドラフト-pull-request)
        - [Pull Request の説明](#pull-request-の説明)
        - [Pull Request (PR) ポリシー](#pull-request-pr-ポリシー)
            - [目的](#目的)
            - [Issue-First アプローチ](#issue-first-アプローチ)
            - [オープンPRの条件](#オープンprの条件)
            - [手順](#手順)
            - [責任](#責任)
- [IV. 法的事項](#iv-法的事項)
    - [貢献契約](#貢献契約)

## I. 貢献する前に

まず、コミュニティの基準やプロジェクトの方向性を理解しましょう。

### 1. 行動規範

すべてのコントリビューターは[行動規範](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md)を守る必要があります。貢献前に必ず読んでください。

### 2. プロジェクトロードマップの理解

Roo Code には明確な開発ロードマップがあり、優先順位や今後の方向性を示しています。ロードマップを理解することで、以下のことができます：

- 貢献をプロジェクトの目標に合わせられる
- 自分のスキルが最も活かせる分野を見つけられる
- 特定の設計判断の背景を理解できる
- ビジョンに沿った新機能のアイデアを得られる

現在のロードマップは6つの柱に重点を置いています：

#### プロバイダーサポート

できるだけ多くのプロバイダーをしっかりサポートしたい：

- より多くの「OpenAI Compatible」サポート
- xAI、Microsoft Azure AI、Alibaba Cloud Qwen、IBM Watsonx、Together AI、DeepInfra、Fireworks AI、Cohere、Perplexity AI、FriendliAI、Replicate
- Ollama と LM Studio のサポート強化

#### モデルサポート

Roo ができるだけ多くのモデル（ローカルモデル含む）で動作することを目指します：

- カスタムシステムプロンプトやワークフローによるローカルモデルサポート
- ベンチマーク、評価、テストケース

#### システムサポート

Roo がすべてのPCで快適に動作することを目指します：

- クロスプラットフォームのターミナル統合
- Mac、Windows、Linux での強力かつ安定したサポート

#### ドキュメント

すべてのユーザーとコントリビューターのために、充実した分かりやすいドキュメントを目指します：

- 拡張されたユーザーガイドやチュートリアル
- 明確なAPIドキュメント
- より良いコントリビューターガイド
- 多言語ドキュメントリソース
- インタラクティブな例やコードサンプル

#### 安定性

バグを大幅に減らし、自動テストを増やすことを目指します：

- デバッグログ切り替えスイッチ
- バグ/サポート依頼用の「マシン/タスク情報」コピー用ボタン

#### 国際化

Roo がみんなの言語を話せるようにしたい：

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

ロードマップの目標を推進する貢献は特に歓迎します。これらの柱に沿った作業をしている場合は、PRの説明でぜひ言及してください。

### 3. Roo Code コミュニティに参加する

Roo Code コミュニティとつながるのは、始めるのに最適な方法です：

- **メインの方法**：
    1.  [Roo Code Discord コミュニティ](https://discord.gg/roocode)に参加する。
    2.  参加後、**Hannes Rudolph**（Discord: `hrudolph`）にDMを送り、興味を伝えてアドバイスをもらう。
- **経験者向けの代替案**：Issue-First アプローチに慣れている場合は、[Kanbanボード](https://github.com/orgs/RooVetGit/projects/1)を使い、GitHub上でIssueやPull Requestを通じて直接参加できます。

## II. 貢献内容の発見と計画

何に取り組むか、どう進めるかを決めましょう。

### 1. 貢献の種類

さまざまな貢献を歓迎します：

- **バグ修正**：既存コードの問題を修正
- **新機能**：新しい機能の追加
- **ドキュメント**：ガイドや例の改善、誤字修正

### 2. 重要な原則: Issue-First アプローチ

**すべての貢献は GitHub Issue から始めてください。** これは方向性の統一と無駄な作業を防ぐために重要です。

- **Issue を探す/作成する**：
    - 作業を始める前に、[GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) で既存のIssueがあるか確認してください。
    - 既存で未割り当てなら、コメントして担当希望を伝えてください。メンテナーが割り当てます。
    - なければ、[Issuesページ](https://github.com/RooVetGit/Roo-Code/issues/new/choose)で適切なテンプレートを使って新規作成：
        - バグは「Bug Report」テンプレート
        - 新機能は「Detailed Feature Proposal」テンプレート。実装前にメンテナー（特に@hannesrudolph）の承認を待ってください。
        - **注**：機能のアイデアや初期議論は[GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests)で始められます。具体化したら「Detailed Feature Proposal」Issueを作成してください。
- **担当表明と割り当て**：
    - 担当したいIssueにはコメントで意思表示してください。
    - メンテナーが正式にGitHubで割り当てるのを待ちましょう。重複作業を防げます。
- **守らない場合の結果**：
    - 関連Issueがない、承認・割り当てされていないPRは、完全なレビューなしでクローズされる場合があります。これはプロジェクトの優先順位を守り、みんなの時間を大切にするためです。

このアプローチで作業の追跡、変更の必要性の確認、効果的な連携ができます。

### 3. 何に取り組むか決める

- **Good First Issues**：GitHubの[「Issue [Unassigned]」セクション](https://github.com/orgs/RooVetGit/projects/1)をチェック
- **ドキュメント**：この `CONTRIBUTING.md` はコード貢献の主なガイドですが、他のドキュメント（ユーザーガイドやAPIドキュメントなど）に貢献したい場合は、[Roo Code Docsリポジトリ](https://github.com/RooVetGit/Roo-Code-Docs)を参照するか、Discordコミュニティで質問してください。
- **新機能の提案**：
    1.  **初期アイデア/議論**：大まかなアイデアや初期の提案は[GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests)で始めてください。
    2.  **正式な提案**：具体的で実装可能な提案は[Issuesページ](https://github.com/RooVetGit/Roo-Code/issues/new/choose)の「Detailed Feature Proposal」テンプレートでIssueを作成してください。これは**Issue-Firstアプローチ**の重要な部分です。

### 4. バグや問題の報告

バグを見つけた場合：

1.  **既存Issueの検索**：[GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues)で重複がないか確認
2.  **新規Issueの作成**：ユニークな場合は[Issuesページ](https://github.com/RooVetGit/Roo-Code/issues/new/choose)の「Bug Report」テンプレートを使う

> 🔐 **セキュリティ脆弱性**：脆弱性を発見した場合は[GitHubのSecurity Advisory Tool](https://github.com/RooVetGit/Roo-Code/security/advisories/new)で非公開で報告してください。公開Issueは作成しないでください。

## III. 開発と提出のプロセス

以下の手順でコーディングと提出を進めてください。

### 1. 開発環境のセットアップ

1.  **Fork & Clone**：
    - GitHubでリポジトリをフォーク
    - 自分のフォークをローカルにクローン：`git clone https://github.com/あなたのユーザー名/Roo-Code.git`
2.  **依存関係のインストール**：`npm run install:all`
3.  **Webview（開発モード）を起動**：`npm run dev`（Vite/ReactアプリのHMR用）
4.  **拡張機能のデバッグ**：VS Codeで `F5`（または **Run** → **Start Debugging**）を押して、Roo Codeが読み込まれた新しい Extension Development Host ウィンドウを開く

webview（`webview-ui`）の変更はHot Module Replacementですぐ反映されます。コア拡張（`src`）の変更はExtension Development Hostの再起動が必要です。

また、`.vsix`パッケージをビルド・インストールする場合：

```sh
npm run build
code --install-extension bin/roo-cline-<version>.vsix
```

（`<version>`はビルドされたファイルの実際のバージョン番号に置き換えてください）

### 2. コーディングガイドライン

- **フォーカスしたPR**：1つの機能/バグ修正ごとに1つのPR
- **コード品質**：
    - CIチェック（リント、フォーマット）を通す
    - ESLintの警告やエラーを修正（`npm run lint`）
    - 自動コードレビューのフィードバックに対応
    - TypeScriptのベストプラクティスを守り、型安全を維持
- **テスト**：
    - 新機能にはテストを追加
    - `npm test`で全テストが通ることを確認
    - 既存テストに影響がある場合は更新
- **コミットメッセージ**：
    - 明確で説明的なコミットメッセージを書く
    - 関連Issueを `#issue-number`（例：`Fixes #123`）で参照
- **PR提出前のチェックリスト**：
    - ブランチを最新のupstream `main`にリベース
    - コードがビルドできることを確認（`npm run build`）
    - すべてのテストが通ることを確認（`npm test`）
    - デバッグ用コードや `console.log` を削除

### 3. コード提出: Pull Request (PR) プロセス

#### ドラフト Pull Request

まだ完全なレビュー準備ができていない作業にはドラフトPRを使いましょう：

- 自動チェック（CI）を走らせたい
- メンテナーや他のコントリビューターから早めにフィードバックが欲しい
- 作業中であることを示したい

すべてのチェックが通り、「コーディングガイドライン」と「Pull Request の説明」の基準を満たしていると思ったら「Ready for Review」にしてください。

#### Pull Request の説明

PRの説明は十分に詳細で、[Pull Request テンプレート](.github/pull_request_template.md)の構成に従ってください。主なポイント：

- 対応する承認済みGitHub Issueへのリンク
- 変更内容と目的の明確な説明
- 変更をテストするための詳細な手順
- 重大な変更点（breaking changes）のリスト
- **UI変更の場合はビフォーアフターのスクリーンショットや動画**
- **PRでユーザードキュメントの更新が必要な場合は、どのドキュメント/セクションか明記**

#### Pull Request (PR) ポリシー

##### 目的

クリーンでフォーカスされた、管理しやすいPRバックログを維持すること。

##### Issue-First アプローチ

- **必須**：作業開始前に、既存で承認・割り当て済みのGitHub Issue（「Bug Report」または「Detailed Feature Proposal」）が必要
- **承認**：特に大きな変更の場合、メンテナー（特に@hannesrudolph）による事前承認が必要
- **参照**：PRの説明でこれらのIssueを明示的に参照すること
- **違反時の結果**：このプロセスを守らないPRは、完全なレビューなしでクローズされる場合があります

##### オープンPRの条件

- **マージ準備完了**：すべてのCIテストに合格し、（該当する場合）ロードマップに沿い、承認・割り当て済みIssueに紐付けられ、明確なドキュメント/コメントがあり、UI変更にはビフォーアフター画像/動画がある
- **クローズ対象**：CIテスト失敗、大きなマージコンフリクト、プロジェクト目標と不一致、長期間（30日超）フィードバック後に更新なし

##### 手順

1.  **Issueの確認と割り当て**：@hannesrudolph（または他のメンテナー）が新規・既存Issueを確認し、割り当てる
2.  **初期PRトリアージ（毎日）**：メンテナーが新規PRを素早くチェックし、緊急・重要なものを振り分け
3.  **詳細なPRレビュー（週次）**：メンテナーがPRの準備状況、Issueとの整合性、全体品質を詳細に確認
4.  **詳細なフィードバックと反復**：レビューに基づき、Approve/Request Changes/Rejectのフィードバック。コントリビューターは対応・修正
5.  **決定段階**：承認されたPRはマージ。不適合や解決不能なPRは理由を明記してクローズ
6.  **フォローアップ**：クローズされたPRの著者は、問題解決や方向転換後に新たなPRを提出可能

##### 責任

- **Issueの確認とプロセス遵守（@hannesrudolph & メンテナー）**：すべての貢献がIssue-Firstアプローチに従うよう確認し、コントリビューターをガイド
- **メンテナー（開発チーム）**：PRの初期・詳細レビュー、技術的フィードバック、承認/却下判断、マージ
- **コントリビューター**：承認・割り当て済みIssueに紐付け、品質ガイドライン遵守、迅速なフィードバック対応

このポリシーは明確さと効率的な統合を保証します。

## IV. 法的事項

### 貢献契約

Pull Request を提出することで、あなたの貢献が [Apache 2.0 ライセンス](LICENSE)（またはプロジェクトの現行ライセンス）で提供されることに同意したことになります。プロジェクトと同じです。
