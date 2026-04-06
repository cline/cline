# Cline Enterprise: Capabilities Manual

**AI-Powered Coding Agent for Regulated Industries**

## Table of Contents

1. [Executive Summary](#executive-summary)  
2. [Security & Data Architecture](#security--data-architecture)  
3. [Developer Onboarding Path](#developer-onboarding-path)  
4. [Bring Your Own Inference](#bring-your-own-inference)  
5. [Identity, Access & Governance](#identity-access--governance)  
6. [Monitoring & Observability](#monitoring--observability)  
7. [Core Agent Capabilities](#core-agent-capabilities)  
8. [Customization & Policy Enforcement](#customization--policy-enforcement)  
9. [Extensibility — MCP Servers](#extensibility--mcp-servers)  
10. [CLI & CI/CD Automation](#cli--cicd-automation)  
11. [Resources & Support](#resources--support)

## Executive Summary

Cline is an open-source AI coding agent that runs entirely inside your developer's editor, whether it be VS Code, JetBrains, Cursor, or the terminal. It reads files, runs commands, and builds features through natural language, with every action visible and requiring explicit developer approval.

For organizations in regulated industries (financial services, healthcare, government, defense, energy, pharmaceuticals, etc) Cline Enterprise adds the governance, observability, and security controls that compliance and platform teams require:

- **Zero-trust, client-side architecture** — Code never leaves your environment. No uploads. No indexing. No training.  
- **Bring Your Own Inference** — Connect your preferred provider (AWS Bedrock, GCP Vertex AI, Azure OpenAI, or local models). Cline is the harness; you own the inference.  
- **Enterprise SSO & RBAC** — Authenticate via your identity provider. Enforce role-based access. Manage centrally.  
- **Full observability** — OpenTelemetry export to your existing monitoring stack for usage, cost, and audit trail integration.  
- **Open source** — Every line of code is on [GitHub](https://github.com/cline/cline) with 50,000+ stars. Full auditability for your security review process.

Cline Enterprise is designed so that your security, compliance, and infrastructure teams can approve it. Your developers will actually want to use it.

## Security & Data Architecture

### Zero-Trust by Design

Cline operates under a zero-trust model. The agent runs entirely on the developer's workstation. There is no server-side component processing code, no cloud relay, and no intermediary between the developer and their chosen inference provider.

| Security Property | Detail |
| :---- | :---- |
| **Code residency** | All code stays on the developer's machine. Nothing is uploaded to Cline's infrastructure. |
| **Inference path** | API calls go directly from the developer's machine to your configured provider (e.g., AWS Bedrock in your VPC). Cline does not proxy, cache, or log these calls. |
| **No codebase indexing** | Cline does not build vector indexes, embeddings, or caches of your repositories. Context is gathered locally on-demand, per-task. |
| **No model training** | Your code, prompts, and outputs are never used for model training — by Cline or by the inference provider (subject to your provider agreement). |
| **Open-source codebase** | The full source is available for security review at [github.com/cline/cline](https://github.com/cline/cline). |

### Human-in-the-Loop Controls

Cline proposes; the developer decides. When Cline wants to edit a file, it shows the diff and waits. When it wants to run a shell command, it shows the command and waits. Nothing executes until the developer hits approve.

In practice, this means a developer reviewing a Cline session sees the same granularity they'd see in a code review: every proposed change, every command, every browser action. Auditors and team leads can look at a task's history and see exactly what was requested, what was approved, and what was executed.

For teams that want to move faster on trusted operations, auto-approval policies let you selectively relax this. For example: allow file reads without prompting, but always require approval for writes and shell commands. Platform teams set these policies centrally via remote configuration, individual developers can't override them.

### File Access Controls

The `.clineignore` file lets organizations define files and directories that Cline cannot access similar to `.gitignore` syntax. Use this to enforce boundaries around:

- Secrets and credential files  
- Regulated data directories  
- Legacy or sensitive code paths  
- Third-party proprietary code

### Network & Proxy Support

Cline supports enterprise proxy configurations out of the box:

- HTTP/HTTPS proxy via environment variables  
- Custom certificate authorities for TLS inspection  
- Compatibility with corporate network policies

### Compliance Certifications

Cline is SOC 2 certified. The full open-source codebase is available at [github.com/cline/cline](https://github.com/cline/cline) for independent security review by your team.

## Developer Onboarding Path

Most teams get through the essentials in one week. Here is the recommended path:

### Week 1: Core Competency

| Day | Focus | Module | Outcome |
| :---- | :---- | :---- | :---- |
| 1–2 | **Install & First Prompt** | Getting Started | Developer has Cline installed, connected to the org's provider, and has run their first successful prompt. |
| 2–3 | **Plan & Act Mode** | Plan & Act | Developer understands when to plan vs. execute. Can use Plan mode to explore code and Act mode to implement changes. |
| 3–4 | **Prompting Techniques** | Effective Prompts | Developer avoids common prompt mistakes. Knows zero-shot, one-shot, and chain-of-thought techniques. |
| 5 | **Checkpoints & Context** | Context Management | Developer uses checkpoints to restore state. Understands context windows and when to use `/newtask` or `/smol`. |

### Week 2–3: Advanced Skills

| Focus | Module | Outcome |
| :---- | :---- | :---- |
| **Custom Rules** | Customization | Developer creates and uses `.clinerules` for team standards. Understands conditional rules. |
| **Memory Bank** | Customization | Developer sets up Memory Bank for project continuity across sessions. |
| **Tools & Features** | Tools & Features | Developer uses @-mentions, slash commands, and auto-approve effectively. |
| **MCP Servers** | MCP | Developer can install and use MCP servers. Understands how to request custom servers. |

### Key Resources for Onboarding

| Resource | URL |
| :---- | :---- |
| Full Documentation | [docs.cline.bot](https://docs.cline.bot) |
| Bad Prompt Examples | [cline.bot/blog/the-worst-instructions-you-can-give-an-ai-coding-agent](https://cline.bot/blog/the-worst-instructions-you-can-give-an-ai-coding-agent) |
| Community Prompts | [github.com/cline/prompts](https://github.com/cline/prompts) |
| Model Selection Guide | [docs.cline.bot/core-features/model-selection-guide](https://docs.cline.bot/core-features/model-selection-guide) |
| Plan & Act Deep Dive | [cline.bot/blog/plan-smarter-code-faster-clines-plan-act-is-the-paradigm-for-agentic-coding](https://cline.bot/blog/plan-smarter-code-faster-clines-plan-act-is-the-paradigm-for-agentic-coding) |
| Context Window Explained | [cline.bot/blog/clines-context-window-explained-maximize-performance-minimize-cost](https://cline.bot/blog/clines-context-window-explained-maximize-performance-minimize-cost) |
| Memory Bank Guide | [cline.bot/blog/memory-bank-how-to-make-cline-an-ai-agent-that-never-forgets](https://cline.bot/blog/memory-bank-how-to-make-cline-an-ai-agent-that-never-forgets) |
| MCP Servers Explained | [cline.bot/blog/mcp-servers-explained-what-they-are-how-they-work-and-why-cline-is-revolutionizing-ai-tools](https://cline.bot/blog/mcp-servers-explained-what-they-are-how-they-work-and-why-cline-is-revolutionizing-ai-tools) |
| Cline CLI | [docs.cline.bot/cline-cli/overview](https://docs.cline.bot/cline-cli/overview) |

## Bring Your Own Inference

Cline is a harness. You bring your own inference. Connect your preferred provider, and Cline sends API calls directly from the developer's machine to that provider. There is no Cline relay, proxy, or middleware in the path.

### Supported Providers

Cline supports a wide range of inference providers. For enterprise deployments, these fall into three categories:

**1. Online Providers (Direct API)**

Direct API connections to hosted model providers. API calls go from the developer's machine to the provider's endpoint.

- Anthropic (Claude), OpenAI, Google Gemini, DeepSeek, Mistral, xAI (Grok), Together, Fireworks, Groq, SambaNova, Cerebras, and others
- Aggregators like OpenRouter and Requesty that route to multiple model providers

**2. Virtual Cloud Providers (VCP): Within Your Cloud Account**

For organizations that need inference to stay inside their cloud environment. Traffic stays in your account and region.

- **AWS Bedrock**: IAM-based authentication. Inference stays in your VPC. Works with CloudTrail for audit logging.
- **Google Vertex AI**: Service account authentication. Runs in your GCP project.
- **Azure OpenAI**: AAD authentication. Managed endpoint in your Azure subscription.
- **LiteLLM**: Self-hosted proxy that can front any provider. Deploy in your own infrastructure.

**3. Local Models: No Network Egress**

For air-gapped environments or teams that need to run models on-premises with zero network calls.

- **Ollama**: Run open-weight models locally.
- **LM Studio**: Local model hosting with a GUI.
- Any **OpenAI-compatible** local endpoint.

### Why This Matters for Regulated Industries

- **Data residency**: With VCP or local providers, inference stays within your cloud account, region, or machine.
- **Model governance**: Platform teams control which models developers can access via remote configuration.
- **Air-gapped deployment**: Local models work in environments with no internet access.

### Remote Provider Configuration

Admins configure the organization's inference provider centrally. Developers authenticate via SSO and are automatically connected, so there are no API keys on laptops.

Supported remote configuration paths:

- [AWS Bedrock — Admin Configuration](https://docs.cline.bot/enterprise-solutions/configuration/remote-configuration/aws-bedrock/admin-configuration)  
- [GCP Vertex AI — Admin Configuration](https://docs.cline.bot/enterprise-solutions/configuration/remote-configuration/google-vertex/admin-configuration)  
- [OpenAI Compatible (including Azure Foundry) — Admin Configuration](https://docs.cline.bot/enterprise-solutions/configuration/remote-configuration/openai-compatible/admin-configuration)  
- [Anthropic — Admin Configuration](https://docs.cline.bot/enterprise-solutions/configuration/remote-configuration/anthropic/admin-configuration)  
- [LiteLLM — Admin Configuration](https://docs.cline.bot/enterprise-solutions/configuration/remote-configuration/litellm/admin-configuration)

## Identity, Access & Governance

### SSO Authentication

Cline Enterprise integrates with your existing identity provider via WorkOS. Supported providers include Okta, Azure AD (Entra ID), Google Workspace, and any SAML/OIDC-compatible IdP. Users are provisioned automatically on first sign-in. No manual invites or seat management required.

For setup instructions, see the [SSO Setup Guide](https://docs.cline.bot/enterprise-solutions/sso-setup).

### Role-Based Access Control

Three-tier hierarchy with organization-scoped permissions:

| Role | Capabilities |
| :---- | :---- |
| **Owner** | Full control. Manage billing, SSO configuration, and organization settings. |
| **Admin** | Manage members, configure providers, set governance policies. |
| **Member** | Use Cline with the models and features enabled by their organization. |

Roles map automatically from your identity provider. Admin in IdP → Admin in Cline. Member in IdP → Member in Cline.

### Centralized Governance

Platform teams can enforce policies organization-wide:

- **Model allow-listing** — Restrict which AI models developers can access  
- **Feature controls** — Govern auto-approval settings, tool access, and feature flags  
- **Remote configuration** — Push settings to all developer installations from a central dashboard  
- **Consistent deployment** — Configure once, deploy everywhere via your existing software distribution

### Access Lifecycle Management

| Event | What Happens |
| :---- | :---- |
| User added to IdP | Access granted automatically on first SSO sign-in |
| Role changed in IdP | Updated on next sign-in |
| User removed from IdP | Access revoked automatically |

No Cline-specific user management required. Your directory is the source of truth.

## Monitoring & Observability

### OpenTelemetry Integration

Cline exports telemetry via OTLP (OpenTelemetry Protocol). It supports gRPC, HTTP/JSON, and HTTP/protobuf transport, so it works with any OTLP-compatible backend: Datadog, Grafana, Splunk, New Relic, or your own collector.

### What You Can Track

Cline emits structured metrics and log events via OpenTelemetry:

- **Token usage**: Input and output tokens per request and cumulative totals, broken down by model
- **Cost**: Per-event and cumulative cost, attributed to task and model
- **API performance**: Time to first token, request duration, throughput (tokens/sec)
- **Tool calls**: Count of tool invocations per task, broken down by tool name
- **Errors**: Error counts per task and total, with error type attributes
- **Cache efficiency**: Cache read/write token counts and hit rates
- **Task activity**: Turn counts per task, task lifecycle events
- **User and auth events**: Sign-in, sign-out, and identification events with organization context

### Compliance Value

All telemetry is exported to your infrastructure. No data is sent to Cline.

- **Cost visibility**: Token and cost metrics let you track AI spend per model and set budget alerts in your monitoring stack.
- **Usage auditing**: Token, model, and task data provide an auditable record of AI usage across the organization.
- **Alerting**: Raw metrics in your observability platform let you build alerts for unusual patterns.

## Core Agent Capabilities

Cline's agent loop gives developers a structured workflow for AI-assisted development. Every capability below operates with human-in-the-loop approval by default.

### Plan & Act Mode

Cline's dual-mode system separates thinking from doing:

- **Plan mode** — Cline explores the codebase, gathers context, and discusses strategy. It can read files and search code but cannot modify anything. Use this for architecture decisions, debugging investigations, and code review.  
- **Act mode** — Cline implements the plan. It can edit files, run commands, and execute the strategy discussed in Plan mode. Full context from planning carries over.

This separation is intentional. It prevents wasted tokens, reduces errors, and creates a natural review checkpoint before any code changes occur.

**Different models for each mode** — Use a stronger reasoning model (e.g., Claude Opus) for planning and a faster model (e.g., Claude Sonnet) for implementation to optimize cost and quality.

### Built-In Tools

| Category | Capabilities |
| :---- | :---- |
| **File operations** | Read, write, search, and analyze code across the project. Targeted edits with diff-based precision. |
| **Terminal** | Execute CLI commands with real-time output streaming. Run tests, install packages, debug errors. |
| **Browser** | Launch a Puppeteer-controlled browser to test web apps, capture screenshots, interact with pages. |
| **Code intelligence** | List code definitions, search with regex, understand project structure. |
| **Task management** | Context handoff between tasks, conversation compression, follow-up questions. |

### Context Management

AI models have finite context windows. Cline provides multiple tools to manage this efficiently:

- **Checkpoints** — Automatic snapshots of project state. Restore to any previous point instantly, rather than manually undoing changes.  
- **`/newtask`** — Start a new task with distilled context from the current session. Like a developer handoff.  
- **`/smol`** — Compress conversation history within the same task to free context space.  
- **Auto-Compact** — Automatic context compression as you work.  
- **`@`\-mentions** — Reference specific files, folders, URLs, terminal output, and git diffs to give Cline precise context without loading the entire project.

### Deep Planning

For complex tasks, the `/deep-planning` command triggers a structured four-step planning process before any code is written:

1. **Silent investigation**: Cline reads files and runs terminal commands (project structure discovery, class/function scanning, dependency analysis, TODO identification) to build a thorough understanding of the codebase. It does this without narration so the developer is not interrupted.
2. **Targeted questions**: Cline asks brief clarifying questions about ambiguous requirements, competing implementation approaches, or assumptions that need confirmation.
3. **Implementation plan document**: Cline writes a structured `implementation_plan.md` covering the overview, type changes, file modifications, function and class changes, dependencies, testing strategy, and implementation order. This document is concrete enough that another developer could execute it without further investigation.
4. **Task handoff**: Cline creates a new task from the plan with a tracked progress checklist, then switches to Act mode for execution. The plan document serves as the reference throughout implementation.

This is useful for large refactors, cross-cutting changes, or any task where getting the approach wrong is expensive. The plan document is a reviewable artifact that lives in the repository.

## Customization & Policy Enforcement

### Cline Rules

Rules are markdown files that provide persistent instructions across all conversations. For enterprise teams, this is how you enforce coding standards, architectural constraints, and compliance requirements at the tool level.

```
your-project/
├── .clinerules/
│   ├── coding-standards.md      # Team coding conventions
│   ├── security-policy.md       # Security review requirements
│   ├── testing-requirements.md  # Coverage and test type mandates
│   ├── architecture.md          # Structural constraints
│   └── compliance.md            # Regulatory-specific rules
```

**Key features for regulated environments:**

- **Version controlled** — Rules live in your repository. Changes are tracked, reviewed, and auditable.  
- **Conditional activation** — Rules scope to specific file paths. Security rules activate only when editing security-sensitive code. Frontend rules don't load for backend work.  
- **Global \+ workspace rules** — Set organization-wide defaults globally, override per-project as needed.  
- **Cross-tool compatibility** — Cline also recognizes `.cursorrules`, `.windsurfrules`, and `AGENTS.md` formats.

**Example: compliance-focused rule**

```
# Security & Compliance Rules

## Data Handling
- Never log PII (names, emails, SSNs, account numbers) to console or files
- Use parameterized queries for all database access — no string interpolation
- Encrypt sensitive data at rest using the patterns in /src/utils/encryption.ts

## Authentication
- All new endpoints require authentication middleware
- Use the RBAC pattern in /src/middleware/auth.ts — do not create custom auth
- Token expiry must not exceed 15 minutes for API tokens

## Audit
- All data mutations must emit an audit event via /src/services/audit.ts
- Include actor, action, resource, and timestamp in every audit entry
```

### .clineignore

Define files and directories Cline cannot access, enforcing information barriers at the tool level:

```
# Secrets and credentials
.env*
secrets/
**/credentials.json

# Regulated data
data/pii/
data/phi/

# Third-party proprietary code
vendor/proprietary/
```

### Memory Bank

Memory Bank is a structured documentation system that maintains project context across sessions. For enterprise teams, this ensures continuity when developers rotate between projects or when onboarding new team members:

```
memory-bank/
├── projectbrief.md      # Foundation document — requirements, goals
├── productContext.md     # Why the project exists, user experience goals
├── activeContext.md      # Current focus, recent changes, next steps
├── systemPatterns.md     # Architecture, design patterns, decisions
├── techContext.md        # Tech stack, dependencies, constraints
└── progress.md           # Status, milestones, known issues
```

## Extensibility — MCP Servers

MCP (Model Context Protocol) is an open protocol that lets Cline connect to external tools and data sources. For enterprise teams, this means Cline can integrate with your internal systems without custom development.

### How MCP Works

MCP servers are lightweight programs that expose tools to Cline through a standardized interface. Think of it as a plugin system where each server provides a set of capabilities that Cline can invoke during a task.

### Enterprise Use Cases

| Category | Examples |
| :---- | :---- |
| **Internal APIs** | Query internal services, retrieve configuration, interact with proprietary systems |
| **Databases** | Run read-only queries, generate reports, analyze data patterns |
| **Project management** | Create Jira tickets, update Confluence pages, sync with ServiceNow |
| **Documentation** | Access internal wikis, API docs, runbooks |
| **Security scanning** | Trigger SAST/DAST scans, retrieve vulnerability reports |
| **Compliance** | Check policy databases, validate configurations against baselines |

### Getting Started

- **MCP Marketplace** — Browse and install pre-built servers: [docs.cline.bot/mcp/mcp-marketplace](https://docs.cline.bot/mcp/mcp-marketplace)  
- **Build custom servers** — Cline can help build MCP servers tailored to your internal tools using the [MCP SDK](https://github.com/modelcontextprotocol/)  
- **Security** — Servers isolate credentials and sensitive data. All tool executions require explicit user approval.

### Transport Options

| Type | Use Case |
| :---- | :---- |
| **stdio** | Command-line servers running locally on the developer's machine |
| **SSE** | HTTP-based servers for shared infrastructure or remote deployment |

---

## CLI & CI/CD Automation

Cline CLI brings the full agent capabilities to your terminal and automation pipelines. It supports all the same providers, MCP servers, and rules as the editor extension.

### Interactive Mode

For terminal-first developers:

```shell
cline
```

Rich terminal interface with real-time conversation, syntax highlighting, @-mentions, slash commands, and keyboard shortcuts.

### Headless Mode

For automation, scripting, and CI/CD:

```shell
# Automated code review in CI
gh pr diff $PR_NUMBER | cline -y "Review for security issues, PII exposure, and SQL injection"

# Automated dependency audit
cline -y "Identify dependencies with known CVEs and suggest updates"

# Generate compliance documentation
cline -y "Generate API documentation for all public endpoints in src/api/"

# Release notes from commits
git log --oneline v1.0..v1.1 | cline -y "Write release notes"
```

### CI/CD Integration Patterns

| Pattern | Command | Value |
| :---- | :---- | :---- |
| **PR security review** | `gh pr diff N | cline -y "Review for security issues"` | Catch vulnerabilities before merge |
| **Test failure remediation** | `cline -y "Run tests and fix failures" --timeout 600` | Automated fix-and-verify loop |
| **Documentation drift** | `cline -y "Verify API docs match implementation"` | Keep docs in sync |
| **Dependency scanning** | `cline -y "Audit dependencies for CVEs"` | Continuous vulnerability monitoring |
| **Code standards** | `cline -y "Check for coding standard violations in changed files"` | Automated style enforcement |

### Output Formats

- **Text** — Human-readable output for logs and reviews  
- **JSON** — Machine-parseable output for pipeline integration: `cline --json "task" | jq '.text'`

## Tailoring Cline to Your Organization

We work with enterprise customers to create organization-specific configurations:

- **Custom `.clinerules` templates** aligned to your coding standards, security policies, and regulatory requirements  
- **Custom MCP servers** connecting Cline to your internal tools, APIs, and documentation  
- **Provider configuration** tuned to your cloud contracts and model governance policies  
- **Onboarding materials** tailored to your team's languages, frameworks, and workflows

To get started, share:

1. Primary languages and frameworks your team uses  
2. Coding standards or conventions documents  
3. Common task types (bug fixes, feature development, code reviews, compliance checks)  
4. Internal tools or systems that would benefit from Cline integration  
5. Any regulatory or compliance requirements that should be encoded as rules

## Resources & Support

| Resource | Link |
| :---- | :---- |
| **Full Documentation** | [docs.cline.bot](https://docs.cline.bot) |
| **Enterprise Overview** | [docs.cline.bot/enterprise-solutions/overview](https://docs.cline.bot/enterprise-solutions/overview) |
| **GitHub (Source Code)** | [github.com/cline/cline](https://github.com/cline/cline) |
| **Discord Community** | [discord.gg/cline](https://discord.gg/cline) |
| **Reddit** | [reddit.com/r/cline](https://www.reddit.com/r/cline/) |
| **Enterprise Inquiries** | [cline.bot/enterprise](https://cline.bot/enterprise) |

*Cline is open-source software. Enterprise features provide governance, observability, and support on top of the same agent that millions of developers trust*  