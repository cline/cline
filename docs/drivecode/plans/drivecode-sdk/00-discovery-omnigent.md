# Discovery: what Omnigent means by "meta harness"

Status: discovery notes. No decisions are binding here. Decisions live in [02-architecture.md](02-architecture.md).

## Why we read it

`drivecode-sdk` was described as "a meta harness akin to Databricks Omnigent". Before adopting the label we needed to know what the label actually buys. Omnigent is the only production-scale meta harness with public docs and public source, so it is the reference implementation whether or not we copy it.

Everything below is sourced. Nothing is inferred from the name.

## Sources

| Source | URL |
|---|---|
| Databricks managed docs | https://docs.databricks.com/aws/en/omnigent/ |
| Databricks quickstart | https://docs.databricks.com/aws/en/omnigent/quickstart |
| Launch blog, architecture rationale | https://www.databricks.com/blog/introducing-omnigent-meta-harness-combine-control-and-share-your-agents |
| OSS repo and README | https://github.com/omnigent-ai/omnigent |
| Agent YAML spec | https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md |
| Policy guide | https://github.com/omnigent-ai/omnigent/blob/main/docs/POLICIES.md |
| Deploy guide | https://github.com/omnigent-ai/omnigent/blob/main/deploy/README.md |
| Harness capability bench | https://github.com/omnigent-ai/omnigent/tree/main/tests/harness_bench |
| Docs site | https://omnigent.ai |

Facts checked on 2026-07-25. Omnigent v0.6.0, Apache 2.0, Python, open sourced 2026-06-16.

## The one-sentence definition, in their words

> "Omnigent is an open-source **meta-harness** that gives you a common orchestration layer over Claude Code, Codex, Cursor, OpenCode, Hermes, Pi, and the agents you write yourself: swap or combine harnesses without rewriting, enforce policies and sandboxing, and collaborate in real time from any device."
> https://github.com/omnigent-ai/omnigent

A meta harness is therefore not a framework for building an agent. It is a layer that sits **above** existing agent harnesses and owns the concerns that no single harness can own.

## The load-bearing insight

The blog states the technical premise plainly.

> "The key insight is that however each agent harness calls into its LLM internally, the interface to users is the same: messages and files in, text streams and tool calls out. Thus we built a common API that wraps both terminal-based coding agents (Claude Code, Codex, Pi, etc) and SDKs (OpenAI Agents, Claude Agents SDK, etc)."
> https://www.databricks.com/blog/introducing-omnigent-meta-harness-combine-control-and-share-your-agents

Two consequences follow, and both matter for us.

The adapter surface is narrow. If the contract is messages and files in, streams and tool calls out, then a harness adapter is a small interface, not a plugin framework. That is why Omnigent can claim a one-line harness swap.

The value is in what sits above the adapter. Omnigent does not try to be a better agent loop. It explicitly cedes the loop to Claude Code or Codex and competes on composition, control, and collaboration.

## Core abstractions

| Abstraction | What it is | Note for us |
|---|---|---|
| Harness | A concrete agent runtime that Omnigent wraps. Named values include `claude-sdk`, `claude-native`, `codex`, `codex-native`, `cursor`, `cursor-native`, `hermes`, `opencode`, `pi`, `openai-agents`. | The `-native` suffix marks a tmux and PTY terminal wrapper. The bare name marks an SDK integration. Two adapter *kinds* under one interface. |
| Executor | The YAML block that binds an agent to a harness. `executor: { harness: claude-sdk }`. | Harness choice is data, not code. This is the whole "one-line swap" claim. |
| Agent | A YAML file with a name, a prompt, a tools map, and an executor. Sub-agents nest inside the same file. | Definition is declarative and portable across harnesses. |
| Tool | One of three types in the YAML tools map. `function` points at a Python callable and derives the schema from the signature. `mcp` points at a local command or a remote URL. `agent` declares a sub-agent the supervisor can delegate to. | Sub-agent delegation is modeled as a tool. That is an elegant collapse worth noticing. |
| `inherit` | A tool value that passes a parent tool down to a sub-agent (`word_count: inherit`). | Scoping mechanism for tool visibility. |
| Runner | Wraps any agent in a sandboxed session and exposes a uniform API. | The per-session process boundary. |
| Server | Provides policies and sharing, and exposes every session over the terminal, the app, and web APIs. | The multi-session, multi-user boundary. Local web UI on `http://localhost:6767`. |
| Host | A registered machine that agents can run on. `omnigent host` registers the local machine. A *managed host* is a sandbox the server provisions per session. | Host is where execution physically happens, and it is separable from where the server runs. |
| Session | The unit of work that carries messages, sub-agents, terminals, and files, and that follows the user across devices. | Session is the central noun. Not "conversation" and not "task". |
| Policy | A stateful, contextual guard evaluated on every agent action, resolving to allow, block, or ask. | See the policy section below. |
| Credential | One of four kinds. API key, subscription (Claude Pro/Max or ChatGPT via the official CLIs), gateway (any OpenAI- or Anthropic-compatible base URL), Databricks workspace. Defaults are per agent. | Model access is a first-class typed concept, not a config string. |
| Sandbox | An isolated execution environment. Providers include Modal, Daytona, Islo, E2B, CoreWeave, Kubernetes, OpenShell, Boxlite, and Databricks. Local isolation uses `bwrap` on Linux and `seatbelt` on macOS. | Pluggable provider list behind one concept. |
| Interface | Terminal, browser web UI, phone, native macOS desktop app, and web APIs, all attached to the same live session. | One session, many views. This is the shape our Drive tab wants. |
| Share, attach, fork | Three distinct collaboration verbs. Share sends a link to watch and chat. Attach co-drives, and the teammate's messages execute on *your* machine. Fork clones the conversation onto the teammate's machine and continues independently. | Three verbs, not one "collaboration" feature. The distinction is the interesting part. |

## Architecture, runner and server

The blog's caption is the clearest statement of the split.

> "Omnigent architecture: A runner wraps any agent in a sandboxed session with a uniform API. A server provides policies and sharing, and exposes every session over the terminal, the app, and web APIs."
> https://www.databricks.com/blog/introducing-omnigent-meta-harness-combine-control-and-share-your-agents

Read as a layer cake, bottom up.

1. **Harness.** Claude Code, Codex, Cursor, an SDK. Owns the agent loop and the LLM call.
2. **Runner.** Wraps one harness in one sandboxed session and normalizes it to the uniform API.
3. **Server.** Owns policies, sharing, identity, and the session registry. Exposes sessions to every interface.
4. **Interfaces.** Terminal, web, phone, desktop app, web API.
5. **Agents as data.** A YAML agent definition is portable across everything below it.

The runner and server split is the part worth studying. The runner is per session and can live on a different machine from the server. That is what makes "start in the terminal, continue on your phone" work without the phone touching the workspace.

## Policy model

Policies are declared in YAML and resolve to allow, block, or ask.

```yaml
policies:
  approve_shell:
    type: function
    handler: omnigent.policies.builtins.safety.ask_on_os_tools
  cap_calls:
    type: function
    handler: omnigent.policies.builtins.safety.max_tool_calls_per_session
    factory_params:
      limit: 50
  budget:
    type: function
    handler: omnigent.policies.builtins.cost.cost_budget
    factory_params:
      max_cost_usd: 5.00
      ask_thresholds_usd: [3.00]
```

Source: https://github.com/omnigent-ai/omnigent (README, section 6).

Three properties are worth copying.

**Three stacking levels.** Server-wide set by an admin, per agent set by a developer, per session set by the user. The stricter session rules are checked first.

**Stateful and contextual, not prompt-based.** The blog is explicit that guardrails run "at the meta-harness layer, not via prompts", and gives a worked example. After an agent downloads a new npm package, require human approval before `git push`. A policy tracks dynamic session state and decides on that state.

**Cost is tracked state.** Spend caps with a soft warning threshold on the way to a hard cap.

The Databricks-managed deployment only supports the built-in contextual policies. Custom policy functions that run arbitrary code are not supported there (https://docs.databricks.com/aws/en/omnigent/). The OSS build has no such restriction. That tells us the arbitrary-code escape hatch is the part that does not survive a multi-tenant host.

## The harness capability problem

Omnigent ships a harness test bench and asks contributors to run it.

> "Adding or changing support for a harness (Claude, Codex, Cursor, OpenCode, Hermes, Pi, ...)? Run the harness test bench to check its capability matrix against observed behavior."
> https://github.com/omnigent-ai/omnigent, https://github.com/omnigent-ai/omnigent/tree/main/tests/harness_bench

This is the honest admission behind the clean abstraction. Harnesses are not actually uniform. Omnigent maintains a **declared capability matrix per harness** and a **bench that checks the declaration against observed behavior**. The uniform API is uniform because capabilities are explicit data that callers can branch on, not because every harness does the same thing.

That is the single most important structural lesson on this page.

## Platform reality check

Windows support is degraded. The server, the web UI, and the SDK-based harnesses work. The native tmux and PTY terminal wrappers do not, and neither does `bwrap` or `seatbelt` sandboxing or the L7 egress proxy. Windows gets a Job Object for process-tree containment, which does not isolate the filesystem or network (https://github.com/omnigent-ai/omnigent).

Harrison's primary machine is Windows. Any design that leans on POSIX sandboxing inherits this gap.

## What Omnigent does not do

It does not own the agent loop. It does not own prompts beyond the agent YAML's `prompt` field. It does not own the model call. It does not replace MCP, it consumes MCP servers as one of three tool types. It does not provide an evaluation or eval-harness abstraction in the shipped surface, GEPA-based optimization is named as roadmap only.

That last point is worth stating clearly because the original brief asked about "evaluation" as a meta-harness concern. In Omnigent as shipped, it is not one.

## Lessons, kept and discarded

| Lesson | Verdict | Why |
|---|---|---|
| A meta harness owns composition, control, and collaboration, and cedes the agent loop | **Keep** | This is the whole thesis and it maps exactly onto Drive. Drive never wanted to write an agent loop, and Cline already has one. |
| Narrow adapter contract: messages and files in, streams and tool calls out | **Keep** | It is the reason a second host is feasible later. Our adapter should be about this small. |
| Explicit per-harness capability matrix plus a bench that verifies it | **Keep** | The antidote to a leaky abstraction. Cline, Cursor, and Claude Code will not agree on interrupt, steer, subagent, or worktree semantics, and pretending they do produces mush. |
| Session as the central noun, with many interfaces attached to one live session | **Keep** | Drive's Room and Stage want exactly this. One session, several views. |
| Policy as stateful data evaluated per action, at three stacking levels | **Keep, trimmed** | Keep per-action evaluation and cost tracking. Trim the server-wide admin level; there is no admin in a single-user local product. |
| Three separate collaboration verbs, share, attach, fork | **Keep the vocabulary** | Fork in particular is a real Drive need and is cheaper than co-drive. Attach is the multi-user feature and is deferred. |
| Agent defined as portable declarative data | **Keep the idea, reject the format** | Declarative agent definitions are right. A Python-callable YAML schema is not. Ours must overlay Cline's `ConfiguredAgent`, not replace it. |
| Runner and server as separate processes | **Reject for now** | Cline already runs a hub. A second daemon is the exact failure mode the drivemode plans ruled out. Take the *conceptual* split, put both roles in the existing hub. |
| Multi-tenant server, OIDC, invite links, admin console | **Reject** | Single user, local, privacy-strict. This is most of Omnigent's surface area and none of our problem. |
| Cloud sandbox providers, OS sandboxing, L7 egress proxy | **Reject for now** | Windows-hostile, large, and orthogonal. Git worktree isolation is the level of isolation Drive actually needs. |
| Custom code policy handlers | **Reject** | Databricks itself would not ship them multi-tenant. A fixed set of typed, declarative policies is safer and enough. |
| Python and YAML as the definition substrate | **Reject** | Cline is TypeScript and Bun. Types in TypeScript beat YAML plus a schema validator. |
| Telemetry on by default | **Reject** | Privacy-strict is a stated invariant for Drive. |

## The one thing Omnigent proves that we needed proven

A meta harness is a real layer with real content, not a rebranding of "wrapper". Composition across harnesses, stateful policy, and one-session-many-views are concerns that genuinely do not belong inside any single harness, and Omnigent shows what it looks like when someone factors them out at scale.

It also shows the cost. Most of Omnigent's surface area is the multi-tenant server, the sandbox providers, and the deployment matrix. Strip those and the portable core is small. That small core is what `drivecode-sdk` should be.
