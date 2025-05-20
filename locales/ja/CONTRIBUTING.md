[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

<b>日本語</b> • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Roo Code への貢献

Roo Code はコミュニティ主導のプロジェクトであり、すべての貢献を大切にしています。協力をスムーズにするため、[Issue-First](#issue-first-アプローチ)方式を採用しています。これはすべての[Pull Request (PR)](#pull-request-の提出)がまずGitHub Issueに紐付けられる必要があることを意味します。このガイドをよく読んでください。

## 目次

- [貢献する前に](#貢献する前に)
- [貢献内容の発見と計画](#貢献内容の発見と計画)
- [開発と提出のプロセス](#開発と提出のプロセス)
- [法的事項](#法的事項)

## 貢献する前に

### 1. 行動規範

すべてのコントリビューターは[行動規範](./CODE_OF_CONDUCT.md)を守る必要があります。

### 2. プロジェクトロードマップ

ロードマップはプロジェクトの方向性を示します。貢献をこれらの主要目標に沿わせてください：

### 信頼性優先

- diff編集とコマンド実行が常に信頼できることを保証
- 定期的な使用を妨げる摩擦ポイントの削減
- すべての言語環境とプラットフォームでのスムーズな動作を保証
- 様々なAIプロバイダーとモデルへの堅牢なサポートを拡大

### ユーザー体験の強化

- 明確さと直感性のためのUI/UXの合理化
- 開発者が日常的に使用するツールに求める高い期待に応えるためのワークフローの継続的改善

### エージェントパフォーマンスの先導

- 実際の生産性を測定する包括的な評価基準（evals）の確立
- 誰もが簡単にこれらの評価を実行して解釈できるようにする
- 評価スコアの明確な向上を示す改善を提供

PRでこれらの領域との関連性に言及してください。

### 3. Roo Code コミュニティに参加する

- **主な方法：** [Discord](https://discord.gg/roocode)に参加し、**Hannes Rudolph (`hrudolph`)**にDMを送る。
- **代替手段：** 経験豊富なコントリビューターは[GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1)を通じて直接参加できます。

## 貢献内容の発見と計画

### 貢献の種類

- **バグ修正：** コードの問題を解決。
- **新機能：** 機能を追加。
- **ドキュメント：** ガイドを改善し明確にする。

### Issue-First アプローチ

すべての貢献はGitHub Issueから始めてください。

- **既存Issueの確認：** [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues)を検索。
- **Issueの作成：** 適切なテンプレートを使用：
    - **バグ：** 「Bug Report」テンプレート。
    - **機能：** 「Detailed Feature Proposal」テンプレート。開始前に承認が必要。
- **Issue担当表明：** コメントし、正式な割り当てを待つ。

**承認されたIssueに紐付けられていないPRは閉じられる可能性があります。**

### 何に取り組むか決める

- 未割り当ての「Good First Issues」を[GitHub Project](https://github.com/orgs/RooCodeInc/projects/1)でチェック。
- ドキュメント関連は[Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs)を参照。

### バグの報告

- まず既存の報告がないか確認。
- 新しいバグは[「Bug Report」テンプレート](https://github.com/RooCodeInc/Roo-Code/issues/new/choose)で報告。
- **セキュリティ問題：** [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new)を通じて非公開で報告。

## 開発と提出のプロセス

### 開発環境のセットアップ

1. **Fork & Clone：**

```
git clone https://github.com/あなたのユーザー名/Roo-Code.git
```

2. **依存関係のインストール：**

```
npm run install:all
```

3. **デバッグ：** VS Codeで`F5`を押して開く。

### コーディングガイドライン

- 1つの機能または修正ごとに1つのPR。
- ESLintとTypeScriptのベストプラクティスに従う。
- 関連Issueを参照する明確なコミットメッセージを書く（例：`Fixes #123`）。
- 十分なテストを提供（`npm test`）。
- 提出前に最新の`main`ブランチにリベース。

### Pull Request の提出

- 早期フィードバックを求める場合は**ドラフトPR**から始める。
- Pull Requestテンプレートに従って変更を明確に説明。
- UI変更のスクリーンショット/動画を提供。
- ドキュメント更新が必要かどうかを示す。

### Pull Request ポリシー

- 承認・割り当て済みIssueを参照する必要がある。
- ポリシーに従わないPRは閉じられる可能性がある。
- PRはCIテストに合格し、ロードマップに沿い、明確なドキュメントを持つべき。

### レビュープロセス

- **日次トリアージ：** メンテナーによる迅速なチェック。
- **週次詳細レビュー：** 包括的な評価。
- **フィードバックに基づいて迅速に改善**。

## 法的事項

Pull Requestを提出することで、あなたの貢献がRoo Codeと同じApache 2.0ライセンスの下で提供されることに同意したことになります。
