# GitHub Integration Sample

Automatically respond to GitHub issues by mentioning `@cline` in comments.

## Setup

1. Copy `.github/workflows/cline-responder.yml` to your repository's `.github/workflows/` directory

2. Configure API keys as repository secrets:
   - `ANTHROPIC_API_KEY` or your LLM provider's key

## Usage

1. Comment on any issue with `@cline` and your question
2. GitHub Actions runs Cline CLI automatically
3. Cline posts its response as a comment

Example:
```
@cline what's causing this error?
```

## How It Works

The workflow:
1. Triggers on issue comments
2. Checks for `@cline` mention (ignores PRs)
3. Installs and starts Cline CLI
4. Downloads the reusable `analyze-issue.sh` script
5. Runs the script with the issue URL and comment
6. Posts Cline's response as a new comment

**Note:** This workflow uses the reusable script from `github-issue-rca` sample.

## Customization

Edit the workflow to change:
- Mention keyword (e.g., `@bot` instead of `@cline`)
- Analysis prompt
- Additional flags (files, images, settings)
