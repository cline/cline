<p align="center">
  <img src="apps/vscode/assets/icons/icon.png" width="160" alt="Bedrock Coder" />
</p>

<h1 align="center">Bedrock Coder</h1>

<p align="center">
  A local-first VS Code coding agent powered exclusively by Amazon Bedrock.
</p>

Bedrock Coder can inspect and edit a workspace, run terminal commands, browse
the web, use MCP servers, preserve checkpoints, and coordinate local agent
teams. File changes and commands remain subject to the approval policy you
choose in the extension.

## What makes this fork different

- Amazon Bedrock is the only model provider.
- AWS credentials come from the standard AWS SDK credential chain and are not
  stored by the extension.
- Settings, history, sessions, rules, hooks, skills, and plugins live under the
  independent `.bedrock-coder/` identity.
- The extension ID is `fffalexgo.bedrock-coder`, so it can be installed
  alongside official Cline without sharing commands or state.
- No hosted account, subscription, telemetry, or Marketplace publishing flow
  is required.

## Repository layout

| Area | Location |
|---|---|
| VS Code extension and webview | [`apps/vscode`](apps/vscode) |
| Runtime SDK packages | [`sdk/packages`](sdk/packages) |
| Implementation plans and results | [`plan`](plan) |

## Development

Requirements: Bun 1.3.13 and Node.js 22 or newer.

```powershell
bun install
bun run build:sdk
cd apps/vscode
bun run check-types
bun run package
```

The extension's AWS permissions and startup behavior are documented in
[`apps/vscode/README.md`](apps/vscode/README.md).

## Local data

The default home is `~/.bedrock-coder/`. Override it with
`BEDROCK_CODER_DIR`; narrower data and settings paths use the
`BEDROCK_CODER_` environment prefix. Workspace instructions use
`.bedrock-coder/`.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report defects through
[GitHub Issues](https://github.com/FFFalexgo/AWS_Bedrock_Coder/issues); report
security vulnerabilities privately through the repository's GitHub Security
Advisories.

## License and attribution

Bedrock Coder is licensed under Apache-2.0. It is an independently maintained
derivative of [Cline](https://github.com/cline/cline) and is not affiliated
with, sponsored by, or endorsed by Cline Bot Inc. or Amazon Web Services. See
[NOTICE](NOTICE), [MODIFICATIONS.md](MODIFICATIONS.md), and [LICENSE](LICENSE).
