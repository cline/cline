# AWS Bedrock Coder Scope

## Status

Finalized. This document defines the product and removal boundaries for the
Bedrock-only Cline fork. Changes that expand or contradict this scope require an
explicit scope revision.

## Product Definition

AWS Bedrock Coder is a VS Code coding agent that uses AWS Bedrock as its only
inference provider. It retains interactive coding, review, local extensibility,
multi-agent, worktree, Kanban, history, checkpoint, and diagnostic capabilities
while removing Cline-hosted commercial services, unrelated providers, remote
control surfaces, and automatic approval bypasses.

## Keep

- AWS Bedrock only
- Environment credentials and AWS profile/SSO
- Region, endpoint and CA bundle
- Dynamic model and inference-profile discovery
- Model selection and automatic doctor
- Streaming chat, progress and cancellation
- Plan and Act modes
- Read files and search codebase
- Multi-file editing and reviewable diffs
- Edit and command approvals
- Optional terminal commands
- Browser automation and web fetching
- Workspace/user-defined MCP, skills and local plugins
- Multi-agent teams
- Worktrees and Kanban
- Git commit message generation
- Conversation history
- Checkpoint compare, restore and resume
- Local diagnostic logs

## Remove

- Every non-Bedrock provider
- Cline accounts, ClinePass, subscriptions and billing
- Cline-hosted authentication
- Public marketplace and hosted plugin distribution
- Telemetry, PostHog and remote feature flags
- Remote enterprise configuration
- Hosted onboarding and marketing
- CLI, desktop and example applications
- YOLO and all automatic approval bypasses
- Jupyter functionality
- AI inline/tab autocomplete
- Any proposed new autocomplete subsystem

## Security and Behavior Boundaries

- Bedrock is the only inference provider available through UI, configuration,
  runtime registration, stored state, migration paths, and child-agent sessions.
- AWS credentials must not be persisted in workspace settings, source control,
  logs, checkpoints, telemetry, or model context.
- Environment credentials use the AWS environment variables inherited by the
  VS Code extension host.
- Profile/SSO authentication uses the AWS SDK credential-provider chain.
- Read-only file reads and bounded code searches may run without interactive
  approval.
- File edits always require review of the proposed diff before application.
- Terminal commands always require explicit approval when terminal support is
  enabled.
- Browser actions, MCP tool calls, worktree mutations, and other state-changing
  operations require explicit approval.
- Plan mode cannot edit files or execute state-changing operations.
- Act mode enables state-changing tools but does not approve them.
- YOLO, auto-approve-all, remembered approval bypasses, and child-agent approval
  bypasses are prohibited.
- Child agents inherit the same Bedrock connection and approval policies as the
  parent session.
- Local MCP servers, skills, and plugins may be discovered only from explicitly
  supported workspace, user, or local filesystem locations.
- Public marketplace discovery, hosted catalog installation, and automatic
  remote package installation are prohibited.
- Telemetry is removed. Local redacted diagnostic logging remains.
- Checkpoints and history must be resumable after VS Code restarts.

## Local Customization Sources

Supported sources:

- Workspace MCP configuration
- User MCP configuration
- Workspace skills
- User skills
- Workspace-local plugins
- User-local plugins
- Explicit local filesystem paths selected by the user

Unsupported sources:

- Cline public marketplace
- Hosted plugin catalogs
- Automatic `npm`, `npx`, or remote URL installation
- Enterprise-synchronized MCP, prompts, rules, or plugins

## Kanban Boundary

The current Cline repository does not contain the standalone Kanban product
source. The CLI only installs and launches an external `kanban` package. The
Bedrock-only fork must not depend on that external product because it would
reintroduce Cline distribution and provider surfaces.

Kanban will therefore be implemented as a local VS Code view backed by retained
session, team, checkpoint, and worktree state. The existing `TeamTasks`
component in `apps/cline-hub` may be used as a reference before that application
is removed.

## Definition of Done

The scope is satisfied when the packaged VSIX:

1. exposes only AWS Bedrock as an inference provider;
2. supports the retained functionality listed above;
3. contains no reachable hosted Cline account, billing, marketplace, telemetry,
   remote configuration, Jupyter, YOLO, or inline-completion functionality;
4. prevents all approval bypasses for state-changing operations;
5. passes Bedrock, editing, approval, team, worktree, Kanban, checkpoint,
   history, diagnostics, Windows, and macOS acceptance coverage.
