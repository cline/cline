# CLI Code Review Workflow

A Cline workflow that uses the CLI as a sub-agent for code reviews.

## Usage

1. Copy `code-review-with-cli.md` to your workflows directory (usually `~/.cline/workflows/`)

2. In your IDE with Cline, type:
   ```
   /code-review-with-cli.md
   ```

3. Cline will ask what you want reviewed, then spawn a CLI instance to perform the review

## How It Works

The workflow file instructs Cline (running in your IDE) to:
1. Ask you for the file/code to review
2. Use `execute_command` to spawn a Cline CLI instance
3. Pass the code to the CLI with a review prompt
4. Wait for the CLI to complete the review
5. Present the findings back to you

## Why Use CLI as Sub-Agent?

- **Separation of concerns:** Main Cline handles conversation, CLI handles review
- **Multiple instances:** Could review multiple files in parallel
- **Consistent reviews:** Same review criteria every time
- **Resource management:** CLI can use different model/settings than main Cline

## Customization

Edit `code-review-with-cli.md` to change:
- Review criteria (security, performance, etc.)
- What files to review
- How results are presented
