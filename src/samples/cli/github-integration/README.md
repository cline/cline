# GitHub Integration Sample

Automatically respond to GitHub issues by mentioning `@cline` in comments using
Cline CLI in GitHub Actions.

The goal is to go from a comment on an issue like this:

![alt text](readme/ss0a-comment.png)

And ask Cline to give provide his thoughts like this:

![alt text](readme/ss0b-final.png)

Let's get this set up!

## Setup

### 1. Copy the Workflow File

Copy the workflow file from this sample to your repository:

```bash
# In your repository root
mkdir -p .github/workflows
cp path/to/cline-responder.yml .github/workflows/
```

Edit the `GITORG` and `GITREPO` variables in the "Download analyze script"
script so that your github action downloads the script it executes from the
correct spot.

The workflow will look for new or issues updates, check for `@cline` and then
start up an instance of the Cline CLI to dig into the issue, providing feedback
as a reply to the issue.

**Important**: The workflow file **must** be placed in `.github/workflows/`
directory in your repository root for GitHub Actions to detect and run it.

### 2. Configure API Keys

Add your AI provider API keys as repository secrets:

1. Go to your GitHub repository
2. Navigate to **Settings** → **Environment** and Add a new environment.

   ![Navigate to Actions secrets](readme/ss01-environment.png)

   Make sure to name it "cline-actions" so that it matches the `environment`
   value at the top of the `cline-responder.yml` file.

3. Click **New repository secret**
4. Add a secret for the `OPENROUTER_API_KEY` with a value of an API key from
   [openrouter.com](https://openrouter.com).

   ![Add API key secret](readme/ss02-api-key.png)

5. Verify your secret is configured:

   ![API key configured](readme/ss03-ready.png)

Now you're ready to supply Cline with the credentials it needs in a github
action.

### 3. Copy Analysis Script

Copy the analysis script from this `github-issue-rca` sample to your repository:

```bash
# In your repository root
mkdir git-scripts
cp path/to/analyze-issue.sh git-scripts/
```
This analysis script will call Cline to execute a prompt on a github issue,
summarizing the output to populate the reply to the issue.

### 4. Commit and Push

```bash
git add .github/workflows/cline-responder.yml
git add git-scripts/analyze-issue.sh
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
3. **Installs** Cline CLI globally using npm
4. **Creates** a Cline instance using `cline instance new`
5. **Configures** authentication using `cline config set open-router-api-key=...
   --address ...`
6. **Downloads** the reusable `analyze-issue.sh` script from the
   `github-issue-rca` sample
7. **Runs** analysis with the instance address
8. **Posts** the analysis result as a comment

### Command Used

The workflow uses the script from the **github-issue-rca** sample, which
internally runs:

```bash
cline -y "$PROMPT: $ISSUE_URL" --mode act --address "$CLINE_ADDRESS" -F json
```

**Flags:**
- `-y` / `--yolo` - Yolo mode (non-interactive,
  auto-approves all actions)
- `--mode act` - Uses Act mode to actively investigate (reads files, runs
  commands, etc.)
- `--address` - Specifies which Cline instance to use
- `-F json` - JSON output format for parsing

## Related Samples

- **github-issue-rca**: The reusable script that powers this integration
