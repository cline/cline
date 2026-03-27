# Shannon Skill for Claude Code

Autonomous AI pentester as a Claude Code skill. Wraps [KeygraphHQ/Shannon](https://github.com/KeygraphHQ/shannon) — the white-box security testing framework that analyzes source code, identifies attack vectors, and executes real exploits to prove vulnerabilities before they reach production.

**96.15% exploit success rate** on the [XBOW security benchmark](https://github.com/KeygraphHQ/shannon#benchmarks) (100/104 exploits).

## Install

```bash
npx skills add unicodeveloper/shannon
```

Or install globally:

```bash
npx skills add unicodeveloper/shannon -g -y
```

## Quick Start

Once installed, run from Claude Code:

```
/shannon http://localhost:3000 myapp
```

Shannon will:
1. Confirm you have authorization to test the target
2. Clone/update the Shannon framework if not already installed
3. Link your source code into Shannon's workspace
4. Check Docker and API credentials
5. Launch a full autonomous pentest across 5 OWASP categories
6. Report findings with reproducible proof-of-concept exploits

## Usage Examples

### Full pentest of a local app

```
/shannon http://localhost:3000 myapp
```

### Pentest a staging environment with a named workspace

```
/shannon --workspace=audit-q1 http://staging.example.com backend-api
```

### Target specific vulnerability categories

```
/shannon --scope=xss,injection http://localhost:8080 frontend
```

### Check running pentests

```
/shannon status
```

### View latest report

```
/shannon results
```

### Stop a running pentest

```
/shannon stop
```

## Prerequisites

### Required

- **Docker** (or Podman) — Shannon runs entirely in containers
  - Install: [docker.com/products/docker-desktop](https://docker.com/products/docker-desktop)
- **Git** — to clone the Shannon framework
- **AI provider credentials** (one of the following):

| Provider | Environment Variable |
|----------|---------------------|
| Anthropic API (recommended) | `ANTHROPIC_API_KEY` |
| Anthropic OAuth | `CLAUDE_CODE_OAUTH_TOKEN` |
| AWS Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials |
| Google Vertex AI | `CLAUDE_CODE_USE_VERTEX=1` + GCP service account |

### Recommended

```bash
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
```

## What Shannon Tests

Shannon covers **50+ vulnerability types** across 5 OWASP categories, all tested with real exploits:

| Category | What's Tested |
|----------|---------------|
| **Injection** | SQL injection (union, blind, time-based), command injection, server-side template injection (SSTI), NoSQL injection, LDAP injection |
| **Cross-Site Scripting** | Reflected XSS, stored XSS, DOM-based XSS, XSS via file upload, mutation XSS |
| **SSRF** | Internal service access, cloud metadata extraction (AWS/GCP/Azure), DNS rebinding, protocol smuggling |
| **Broken Authentication** | Default credentials, JWT vulnerabilities (none algorithm, weak signing), session fixation, CSRF, MFA bypass, brute force, account lockout flaws |
| **Broken Authorization** | IDOR, horizontal/vertical privilege escalation, path traversal, forced browsing, mass assignment, insecure direct object references |

## How It Works

Shannon operates as a multi-agent system with 5 phases:

```
Shannon Pipeline
━━━━━━━━━━━━━━━━

Phase 1: Pre-Recon
├── Static source code analysis
└── External scans (Nmap, Subfinder, WhatWeb)

Phase 2: Recon
└── Live attack surface mapping via headless browser

Phase 3: Vulnerability Analysis (5 parallel agents)
├── Injection agent
├── XSS agent
├── SSRF agent
├── Authentication agent
└── Authorization agent

Phase 4: Exploitation (parallel)
├── Each vuln agent spawns an exploitation agent
└── Real attacks executed to validate findings

Phase 5: Reporting
├── Executive summary
└── Reproducible PoC for every finding
```

**No exploit, no report** — Shannon only reports vulnerabilities it can prove with a working proof-of-concept. This minimizes false positives.

### Integrated Security Tools (bundled in Docker)

- **Nmap** — port scanning and service detection
- **Subfinder** — subdomain enumeration
- **WhatWeb** — web technology fingerprinting
- **Schemathesis** — API schema-based fuzzing
- **Chromium/Playwright** — headless browser for automated exploitation

### Runtime

- **Duration**: ~1–1.5 hours for a full pentest
- **Cost**: ~$50 using Claude Sonnet

## Authentication Configuration

For targets that require login, the skill helps you create a YAML config:

```yaml
# configs/target-config.yaml
authentication:
  type: form                    # "form" or "sso"
  login_url: "http://localhost:3000/login"
  credentials:
    username: "testuser"
    password: "testpass123"
    totp_secret: "BASE32SECRET"  # optional, for 2FA
  flow: "Navigate to login page, enter username and password, click Sign In"
  success_condition:
    url_contains: "/dashboard"

rules:
  avoid:
    - "/logout"
    - "/admin/dangerous-action"
  focus:
    - "/api/"
    - "/auth/"

pipeline:
  max_concurrent_pipelines: 5   # 1-5, default 5
  retry_preset: subscription    # extended backoff for rate-limited API plans
```

## Testing Local Applications

Shannon runs inside Docker, so `localhost` on your machine isn't reachable from the container. The skill automatically handles this, but for reference:

| Platform | Use This Instead of localhost |
|----------|------------------------------|
| macOS / Windows | `http://host.docker.internal:PORT` |
| Linux | `http://host.docker.internal:PORT` (may need `--add-host` flag) |

## Skill Structure

```
shannon-skill/
├── SKILL.md                    # Skill definition (metadata + Claude instructions)
├── CLAUDE.md                   # Project contributor instructions
├── README.md                   # This file
└── scripts/
    ├── setup-shannon.sh        # Installs/updates Shannon, checks prerequisites
    └── sync.sh                 # Deploys skill to ~/.claude, ~/.agents, ~/.codex
```

## Development

### Deploy locally after edits

```bash
bash scripts/sync.sh
```

This syncs the skill to:
- `~/.claude/skills/shannon/`
- `~/.agents/skills/shannon/`
- `~/.codex/skills/shannon/`

### Run the setup script standalone

```bash
bash scripts/setup-shannon.sh
```

Checks Docker, Git, clones Shannon, and validates API credentials.

## Safety

Shannon executes **real attacks** against targets. The skill enforces safety at every step:

- **Authorization gate** — asks for confirmation before every pentest
- **Environment check** — warns against production targets
- **Scope control** — lets you limit which vulnerability categories to test
- **Avoid rules** — config option to exclude sensitive paths (e.g., `/logout`, `/admin/delete`)
- **Containerized** — all attack tools run inside Docker, not on your host

**Never run Shannon against systems you don't own or have explicit written authorization to test.**

## Credits

- **Shannon** by [KeygraphHQ](https://github.com/KeygraphHQ/shannon) — the autonomous pentesting engine (AGPL-3.0)
- **Skill wrapper** — converts Shannon into a Claude Code `/shannon` slash command

## License

AGPL-3.0 — same as Shannon itself.
