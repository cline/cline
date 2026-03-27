---
name: shannon
version: "1.0.0"
description: "Autonomous AI pentester for web apps and APIs. Run white-box security assessments with Shannon — analyzes source code, identifies attack vectors, and executes real exploits to prove vulnerabilities. Triggered by 'shannon', 'pentest', 'security audit', 'vuln scan'."
argument-hint: 'shannon http://localhost:3000 myapp, shannon --workspace=audit1 http://staging.example.com myrepo'
allowed-tools: Bash, Read, Write, AskUserQuestion, WebSearch
homepage: https://github.com/KeygraphHQ/shannon
repository: https://github.com/KeygraphHQ/shannon
author: KeygraphHQ
license: AGPL-3.0
user-invocable: true
metadata:
  openclaw:
    emoji: "🔐"
    category: "security"
    requires:
      env:
        - ANTHROPIC_API_KEY
      optionalEnv:
        - CLAUDE_CODE_OAUTH_TOKEN
        - CLAUDE_CODE_USE_BEDROCK
        - CLAUDE_CODE_USE_VERTEX
        - AWS_REGION
        - AWS_ACCESS_KEY_ID
        - AWS_SECRET_ACCESS_KEY
      bins:
        - docker
        - git
    primaryEnv: ANTHROPIC_API_KEY
    files:
      - "scripts/*"
    tags:
      - security
      - pentesting
      - pentest
      - vulnerability
      - exploit
      - owasp
      - xss
      - sqli
      - ssrf
      - authentication
      - authorization
      - white-box
      - appsec
---

# Shannon: Autonomous AI Pentester for Web Apps & APIs

> **Permissions overview:** This skill orchestrates Shannon, a Docker-based pentesting tool that actively executes attacks against a target application. It clones/updates the Shannon repo locally, runs Docker containers, and reads pentest reports. **Shannon performs real exploits — only run against apps you own or have explicit written authorization to test.** Never run against production systems.

Shannon analyzes your source code, identifies attack vectors, and executes real exploits to prove vulnerabilities before they reach production. 96.15% exploit success rate on the XBOW security benchmark. Covers OWASP Top 10: Injection, XSS, SSRF, Broken Auth, Broken AuthZ, and more.

---

## CRITICAL: Safety Checks (ALWAYS run first)

Before doing ANYTHING, you MUST confirm:

1. **Authorization**: Ask the user — "Do you have explicit authorization to pentest this target?" If they say no or are unsure, STOP and explain they need written permission from the system owner.
2. **Environment**: Confirm the target is a local, staging, or sandboxed environment — NEVER production.
3. **Scope**: Clarify what they want tested (full pentest vs specific category).

```
⚠️  Shannon executes REAL ATTACKS with mutative effects.
├─ Only run on systems you OWN or have WRITTEN AUTHORIZATION to test
├─ Never target production environments
├─ Results require human review — LLM output may contain hallucinations
└─ You are responsible for complying with all applicable laws
```

Display this warning BEFORE every pentest run. If the user has already confirmed authorization in this session, a brief reminder suffices.

---

## Parse User Intent

Extract from the user's input:

1. **TARGET_URL**: The URL to pentest (e.g., `http://localhost:3000`, `http://staging.example.com`)
2. **REPO_NAME**: The source code folder name (placed in `./repos/` inside Shannon)
3. **SCOPE**: Full pentest (default) or specific categories (injection, xss, ssrf, auth, authz)
4. **WORKSPACE**: Named workspace for resume capability (optional)
5. **CONFIG**: Custom YAML config path (optional, for auth flows, focus/avoid rules)

Common invocation patterns:
- `/shannon http://localhost:3000 myapp` → Full pentest of local app
- `/shannon --workspace=audit1 http://staging.example.com backend-api` → Named workspace for resuming
- `/shannon --scope=xss,injection http://localhost:8080 frontend` → Targeted categories
- `/shannon status` → Check running pentests
- `/shannon results` → Show latest report
- `/shannon stop` → Stop running pentest

Display parsed intent:
```
🔐 Shannon Pentest
├─ Target: {TARGET_URL}
├─ Source: repos/{REPO_NAME}
├─ Scope: {SCOPE or "Full (all 5 OWASP categories)"}
├─ Workspace: {WORKSPACE or "auto-generated"}
└─ Config: {CONFIG or "default"}

Estimated runtime: 1–1.5 hours │ Estimated cost: ~$50 (Claude Sonnet)
```

---

## Step 0: Ensure Shannon is Installed

Check if Shannon is cloned locally:

```bash
SHANNON_HOME="${SHANNON_HOME:-$HOME/shannon}"

if [ -d "$SHANNON_HOME" ] && [ -f "$SHANNON_HOME/shannon" ]; then
  echo "Shannon found at $SHANNON_HOME"
  cd "$SHANNON_HOME" && git pull --ff-only 2>/dev/null || true
else
  echo "Shannon not found. Cloning..."
  git clone https://github.com/KeygraphHQ/shannon.git "$SHANNON_HOME"
fi

# Verify Docker is available
if command -v docker &>/dev/null; then
  echo "Docker: $(docker --version)"
else
  echo "ERROR: Docker is required. Install Docker Desktop: https://docker.com/products/docker-desktop"
  exit 1
fi
```

If Shannon is not installed, clone it and inform the user. If Docker is missing, stop and tell them to install it.

**SHANNON_HOME** defaults to `~/shannon`. Users can override with `SHANNON_HOME` env var.

---

## Step 1: Prepare Source Code

Shannon needs the target's source code in `$SHANNON_HOME/repos/{REPO_NAME}/`.

Ask the user where their source code is:

```bash
# If user provides a local path
REPO_PATH="/path/to/their/source"
REPO_NAME="myapp"

# Create symlink or copy into Shannon's repos directory
mkdir -p "$SHANNON_HOME/repos"
if [ ! -d "$SHANNON_HOME/repos/$REPO_NAME" ]; then
  ln -s "$(realpath "$REPO_PATH")" "$SHANNON_HOME/repos/$REPO_NAME"
  echo "Linked $REPO_PATH → repos/$REPO_NAME"
fi
```

If the user provides a GitHub URL instead:
```bash
cd "$SHANNON_HOME/repos"
git clone "$GITHUB_URL" "$REPO_NAME"
```

---

## Step 2: Configure Authentication (if needed)

If the target requires login, help the user create a YAML config:

```yaml
# $SHANNON_HOME/configs/target-config.yaml
authentication:
  type: form            # "form" or "sso"
  login_url: "http://localhost:3000/login"
  credentials:
    username: "admin"
    password: "password123"
  flow: "Navigate to login page, enter username and password, click Sign In"
  success_condition:
    url_contains: "/dashboard"

rules:
  avoid:
    - "/logout"
    - "/admin/delete"
  focus:
    - "/api/"
    - "/auth/"

pipeline:
  max_concurrent_pipelines: 5  # 1-5, default 5
```

**Only create a config if the target requires authentication or has specific scope rules.** For open/unauthenticated targets, no config is needed.

---

## Step 3: Verify API Credentials

Check that AI provider credentials are available:

```bash
cd "$SHANNON_HOME"

# Check for Anthropic API key (primary)
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "✅ ANTHROPIC_API_KEY is set"
elif [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "✅ CLAUDE_CODE_OAUTH_TOKEN is set"
elif [ "${CLAUDE_CODE_USE_BEDROCK:-}" = "1" ]; then
  echo "✅ AWS Bedrock mode enabled"
elif [ "${CLAUDE_CODE_USE_VERTEX:-}" = "1" ]; then
  echo "✅ Google Vertex AI mode enabled"
else
  echo "❌ No AI credentials found."
  echo "Set one of: ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or enable Bedrock/Vertex"
  exit 1
fi
```

If no credentials are found, explain the options:
- **Direct API** (recommended): `export ANTHROPIC_API_KEY=sk-ant-...`
- **OAuth**: `export CLAUDE_CODE_OAUTH_TOKEN=...`
- **AWS Bedrock**: `export CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials
- **Google Vertex**: `export CLAUDE_CODE_USE_VERTEX=1` + service account in `./credentials/`

Also recommend: `export CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`

---

## Step 4: Launch the Pentest

**CRITICAL: Confirm with the user before launching.** Display the full command and wait for approval.

```bash
cd "$SHANNON_HOME"

# Build the command
CMD="./shannon start URL={TARGET_URL} REPO={REPO_NAME}"

# Add optional flags
# CONFIG=configs/target-config.yaml  (if auth config exists)
# WORKSPACE={WORKSPACE}              (if user specified)
# OUTPUT=./audit-logs/               (default)

echo "Ready to launch:"
echo "  $CMD"
echo ""
echo "This will start Docker containers and begin the pentest."
echo "Runtime: ~1-1.5 hours │ Cost: ~\$50 (Claude Sonnet)"
```

After user confirms, run in background:
```bash
cd "$SHANNON_HOME" && ./shannon start URL={TARGET_URL} REPO={REPO_NAME} {EXTRA_FLAGS}
```

Use `run_in_background: true` with a timeout of 600000ms (10 minutes for initial setup). The pentest itself runs in Docker and will continue independently.

---

## Step 5: Monitor Progress

While the pentest runs, the user can check status:

```bash
cd "$SHANNON_HOME"

# List active workspaces
./shannon workspaces

# View logs for a specific workflow
./shannon logs ID={workflow-id}
```

Explain the 5-phase pipeline:
```
Shannon Pipeline (5 phases, parallel where possible):
├─ Phase 1: Pre-Recon — Source code analysis + external scans (Nmap, Subfinder, WhatWeb)
├─ Phase 2: Recon — Live attack surface mapping via browser automation
├─ Phase 3: Vulnerability Analysis — 5 parallel agents (Injection, XSS, SSRF, Auth, AuthZ)
├─ Phase 4: Exploitation — Dedicated agents execute real attacks to validate findings
└─ Phase 5: Reporting — Executive summary with reproducible PoCs
```

---

## Step 6: Read and Interpret Results

Reports are saved to `$SHANNON_HOME/audit-logs/{hostname}_{sessionId}/`.

```bash
cd "$SHANNON_HOME"

# Find the latest report
LATEST=$(ls -td audit-logs/*/ 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then
  echo "Latest report: $LATEST"
  # Find the main report file
  find "$LATEST" -name "*.md" -type f | head -5
fi
```

Read the report and present a summary:

```
🔐 Shannon Pentest Report: {TARGET}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 Critical: {N} vulnerabilities
🟠 High:     {N} vulnerabilities
🟡 Medium:   {N} vulnerabilities
🔵 Low:      {N} vulnerabilities

Top Findings:
1. [CRITICAL] {Vuln type} — {location} — PoC: {brief description}
2. [HIGH] {Vuln type} — {location} — PoC: {brief description}
3. ...

Each finding includes a reproducible proof-of-concept exploit.
```

**IMPORTANT: Shannon's "no exploit, no report" policy means every finding has a working PoC.** But remind the user that LLM-generated content requires human review.

---

## Utility Commands

### Check status
```bash
cd "$SHANNON_HOME" && ./shannon workspaces
```

### View logs
```bash
cd "$SHANNON_HOME" && ./shannon logs ID={workflow-id}
```

### Stop pentest
```bash
cd "$SHANNON_HOME" && ./shannon stop
```

### Stop and clean up all data
```bash
# DESTRUCTIVE — confirm with user first
cd "$SHANNON_HOME" && ./shannon stop CLEAN=true
```

### Resume a previous workspace
```bash
cd "$SHANNON_HOME" && ./shannon start URL={URL} REPO={REPO} WORKSPACE={name}
```

---

## Targeting Local Apps

If the user's app runs on localhost, explain:
```
Shannon runs inside Docker. To reach your local app:
├─ Use http://host.docker.internal:{PORT} instead of http://localhost:{PORT}
├─ macOS/Windows: works automatically with Docker Desktop
└─ Linux: add --add-host=host.docker.internal:host-gateway to docker run
```

Automatically translate `localhost` URLs to `host.docker.internal` in the command.

---

## Configuration Reference

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | One of these | Direct Anthropic API key |
| `CLAUDE_CODE_OAUTH_TOKEN` | required | Anthropic OAuth token |
| `CLAUDE_CODE_USE_BEDROCK` | | Set to `1` for AWS Bedrock |
| `CLAUDE_CODE_USE_VERTEX` | | Set to `1` for Google Vertex AI |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Recommended | Set to `64000` |
| `SHANNON_HOME` | Optional | Shannon install dir (default: `~/shannon`) |

### YAML Config Options
| Section | Field | Description |
|---------|-------|-------------|
| `authentication.type` | `form` / `sso` | Login method |
| `authentication.login_url` | URL | Login page |
| `authentication.credentials` | object | username, password, totp_secret |
| `authentication.flow` | string | Natural language login instructions |
| `authentication.success_condition` | object | `url_contains` or `element_present` |
| `rules.avoid` | list | Paths/subdomains to skip |
| `rules.focus` | list | Paths/subdomains to prioritize |
| `pipeline.retry_preset` | `subscription` | Extended backoff for rate-limited plans |
| `pipeline.max_concurrent_pipelines` | 1-5 | Parallel agent count (default: 5) |

---

## Vulnerability Coverage

Shannon tests 50+ specific cases across 5 OWASP categories:

| Category | Examples |
|----------|----------|
| **Injection** | SQL injection, command injection, SSTI, NoSQL injection |
| **XSS** | Reflected, stored, DOM-based, via file upload |
| **SSRF** | Internal service access, cloud metadata, protocol smuggling |
| **Broken Auth** | Default creds, JWT flaws, session fixation, MFA bypass, CSRF |
| **Broken AuthZ** | IDOR, privilege escalation, path traversal, forced browsing |

---

## Integrated Security Tools (bundled in Docker)

- **Nmap** — port scanning and service detection
- **Subfinder** — subdomain enumeration
- **WhatWeb** — web technology fingerprinting
- **Schemathesis** — API schema-based fuzzing
- **Chromium** — headless browser for automated exploitation (Playwright)

---

## Context Memory

For the rest of this conversation, remember:
- **SHANNON_HOME**: Path to Shannon installation
- **TARGET_URL**: The URL being tested
- **REPO_NAME**: Source code folder name
- **WORKSPACE**: Workspace name (if any)
- **PENTEST_STATUS**: running / completed / stopped

When the user asks follow-up questions:
- Check pentest status and report on progress
- Read and interpret new findings from audit-logs
- Help remediate discovered vulnerabilities with code fixes
- Explain PoC exploits and their impact

---

## Security & Permissions

**What this skill does:**
- Clones/updates the Shannon repo from GitHub to `~/shannon` (or `$SHANNON_HOME`)
- Creates symlinks from user's source code into `~/shannon/repos/`
- Starts Docker containers (Temporal server, worker, optional router) via `./shannon` CLI
- Reads pentest reports from `~/shannon/audit-logs/`
- Optionally creates YAML config files in `~/shannon/configs/`

**What Shannon does (inside Docker):**
- Executes real exploits against the target URL (SQL injection, XSS, SSRF, etc.)
- Scans with Nmap, Subfinder, WhatWeb, Schemathesis
- Automates browser interactions via headless Chromium
- Sends prompts to Anthropic API (or Bedrock/Vertex) for reasoning
- Writes reports to `audit-logs/` directory

**What this skill does NOT do:**
- Does not target any system without user confirmation
- Does not store or transmit API keys beyond the configured provider
- Does not modify the user's source code
- Does not access production systems unless explicitly directed (which it warns against)
- Does not run without Docker — all attack tools are containerized

**Review the Shannon source code before first use:** https://github.com/KeygraphHQ/shannon
