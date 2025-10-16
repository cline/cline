# GitHub Integration Sample

Automatically respond to GitHub issues by mentioning `@cline` in comments using
Cline CLI in GitHub Actions.

## Setup

### 1. Copy the Workflow File

Copy the workflow file from this sample to your repository:

```bash
# In your repository root
mkdir -p .github/workflows
cp path/to/cline-responder.yml .github/workflows/
```

**Important**: The workflow file **must** be placed in `.github/workflows/`
directory in your repository root for GitHub Actions to detect and run it.

### 2. Configure API Keys

Add your AI provider API keys as repository secrets:

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add one or more of these secrets:
   - `ANTHROPIC_API_KEY` - For Claude models

The workflow will automatically use whichever key is available.

### 3. Commit and Push

```bash
git add .github/workflows/cline-responder.yml
git commit -m "Add Cline issue assistant workflow"
git push
```

## Usage

Once set up, simply mention `@cline` in any issue comment:

```
@cline what's causing this error?

@cline analyze the root cause

@cline what are the security implications?
```

GitHub Actions will:
1. Detect the `@cline` mention
2. Start a Cline CLI instance
3. Download the analysis script
4. Analyze the issue using act mode with yolo (fully autonomous)
5. Post Cline's analysis as a new comment

**Note**: The workflow only triggers on issue comments, not pull request
comments.

## How It Works

The workflow (`cline-responder.yml`):

1. **Triggers** on issue comments (created or edited)
2. **Detects** `@cline` mentions (case-insensitive)
3. **Installs** Cline CLI by downloading the latest CLI release tarball
4. **Creates** a Cline instance using `cline instance new` (no auth flow required)
5. **Configures** authentication using `CLINE_API_KEY` environment variable
6. **Downloads** the reusable `analyze-issue.sh` script from the `github-issue-rca` sample
7. **Runs** analysis with the instance address
8. **Posts** the analysis result as a comment

### Command Used

The workflow uses the script from the **github-issue-rca** sample, which runs:

```bash
cline task new "$PROMPT: $ISSUE_URL" --address "$CLINE_ADDRESS" --mode act --yolo
```

**Flags:**
- `--address` - Specifies which Cline instance to use
- `--mode act` - Uses Act mode to actively investigate (reads files, runs commands, etc.)
- `--yolo` / `-y` - Yolo mode (non-interactive, auto-approves all actions)

**Key Insight**: The `CLINE_API_KEY` environment variable is used for API authentication, while `--address` directs commands to the specific instance.

## Customization

### Change the Mention Keyword

Edit the detection step in the workflow:

```yaml
- name: Check for @cline mention
  id: detect
  uses: actions/github-script@v7
  with:
    script: |
      const body = context.payload.comment?.body || "";
      const hit = body.toLowerCase().includes("@bot");  # Change from "@cline"
```

### Customize the Analysis Prompt

Edit the "Run analysis" step:

```yaml
- name: Run analysis
  run: |
    RESULT=$(/tmp/analyze-issue.sh "${ISSUE_URL}" "Your custom prompt here")
```

### Add File Attachments

The underlying Cline CLI supports file attachments. You could modify the script
call to include files:

```bash
cline -y "Analyze with these files" -f file1.txt -f file2.txt --mode act -F plain
```

## Example Workflow

1. User opens an issue: "Application crashes on startup"
2. User comments: `@cline analyze this crash`
3. GitHub Actions triggers the workflow
4. Cline:
   - Fetches the issue details
   - Explores the codebase
   - Identifies root cause
   - Posts detailed analysis
5. Team reviews Cline's analysis and takes action

## Troubleshooting

### Workflow Not Triggering

- Ensure the file is in `.github/workflows/` directory
- Check that the workflow file has `.yml` or `.yaml` extension
- Verify repository has Actions enabled (Settings → Actions)

### Authentication Errors

- Verify API keys are set as repository secrets (not environment variables)
- Check secret names match exactly (case-sensitive)
- Ensure at least one provider key is configured

### No Response Posted

- Check Actions tab in your repository for workflow run logs
- Verify the issue comment contains `@cline` mention
- Ensure the comment is on an issue, not a pull request

## Security Considerations

- API keys are stored as encrypted secrets
- Workflow only runs on issue comments (not PR comments from forks)
- Cline runs in isolated GitHub Actions environment
- Results are posted as comments (visible to all with access to the issue)

## Related Samples

- **github-issue-rca**: The reusable script that powers this integration
