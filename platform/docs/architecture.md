# 21 Agent — architecture

## 1. Components

| Component | Responsibility | Runs on |
| --- | --- | --- |
| Web app (`src/app`) | UI, session-aware server components, JSON APIs | Vercel / Next.js |
| Auth | Signup, verification, recovery, session cookies | Supabase Auth |
| Database | Projects, tasks, events, diffs, usage, queue, audit | Supabase Postgres |
| Worker (`worker/`) | Claims jobs, provisions sandboxes, runs the agent, records results | Long-lived Node 22 process |
| Agent runtime | Cline loop: plan → tool calls → results → finish | Worker |
| Model gateway | OpenRouter chat completions + model catalog | External |
| Sandbox | Isolated Linux filesystem, shell, ports | Daytona |

The web tier is deliberately incapable of executing user code. It can read sandbox
files and run *user-initiated* terminal commands through the provider, but agent runs
are always worker-owned.

## 2. Request & data flow

### 2.1 Sign up / sign in
1. Browser uses `@supabase/ssr` and Supabase Auth directly for signup/sign-in.
2. `src/middleware.ts` refreshes the session on every request and redirects
   unauthenticated `/app/*` traffic to `/sign-in?next=…`.
3. Server components call `requireUser()` (validates the JWT with Supabase, never
   trusts `getSession()`).
4. A `a21_profiles` row and `a21_settings` row are created lazily on first visit. The
   existing UDS `handle_new_user()` trigger writes a different table and is untouched.

### 2.2 Task creation
`POST /api/tasks`:
1. `requireUser()` → session user id.
2. `requireOwnedProject(projectId, userId)` → row or 404 (does not leak existence).
3. Rate limit `task:create` (20/hour) via `a21_consume_rate_limit`.
4. Plan quota: tasks/month, tokens/month, concurrent tasks; also the user's personal
   caps and `settings.max_concurrent_tasks`.
5. Model must be tool-capable when it appears in OpenRouter discovery.
6. Creates a conversation, task (`status=queued`), user message, `task.queued` event,
   audit entry and one `a21_jobs` row.
7. Returns immediately; the UI navigates to the live task page.

### 2.3 Worker claim & execution
`worker/index.ts` → `runTick()` → `a21_claim_job(worker, lease)`:
- `SELECT … FOR UPDATE SKIP LOCKED` over queued jobs (or expired leases).
- Sets `status=running`, `locked_by`, `lease_expires_at`, `attempts += 1`.

`runTask()`:
1. Loads task + project; exits early if the task no longer exists.
2. Starts a heartbeat every 15 s: extends the lease and polls `cancel_requested`.
   If the lease is lost, the runtime is aborted; if cancelled, the runtime is aborted
   and the task ends `cancelled`.
3. `ensureWorkspace()` — resumes a ready sandbox or provisions a new one (with a
   database claim to prevent duplicate sandboxes), writes the template, optionally
   clones a public repo, detects/installs the language runtime.
4. Resolves the OpenRouter key server-side (user BYOK first, then platform key).
5. Builds `AgentRuntime` from `@cline/agents` with the system prompt, tools and
   intent policies; `run([])` continues from persisted history.
6. Cline executes tool calls sequentially. Each tool validates paths/commands, calls
   Daytona, and records file changes.
7. Runtime events are persisted to `a21_task_events` (text deltas buffered ~350 ms).
8. On `finish_task`, the worker writes the summary, tests run, remaining issues, token
   usage/cost, files changed, `status=succeeded`, and finishes the job.
9. On failure it classifies permanent vs transient errors. Transient errors retry with
   exponential-ish backoff up to the job's `max_attempts`; a continuation message is
   appended so the next attempt resumes from the real workspace state.

### 2.4 Approvals
When a project uses `approval_mode=writes`:
- `requestToolApproval` is called before gated tools (`write_file`, `edit_file`,
  `delete_file`, `run_command`, `start_server`).
- If no decision exists, the worker inserts `a21_approvals` (unique per
  task/tool/input hash), emits `approval.required`, sets the task `waiting_approval`,
  parks the job and returns without applying anything.
- The UI shows the exact tool input. Approving records the decision, appends an
  instruction to re-run the same action, and requeues the job; rejecting stops the task.
- Replaying the pause uses the same input hash, so the approved action runs once.

### 2.5 Cancellation
- `POST /api/tasks/[id]/cancel` sets `cancel_requested=true`.
- Queued/paused tasks are finalized immediately and their job is cancelled.
- Running tasks are aborted by the next heartbeat; the agent loop throws, the worker
  marks the task cancelled and finishes the job.
- The sandbox is left intact so partial work can be inspected.

### 2.6 Retries & recovery
- Job leases expire after `WORKER_LEASE_SECONDS`; another worker can reclaim
  `running` jobs whose lease expired.
- `a21_retry_job` resets the job to `queued` with `run_after` backoff.
- Fatal errors (401/402/403, unsupported model, missing credentials) are not retried.
- Sandbox provisioning has a 3-minute stale-claim recovery path.

## 3. Data model (all namespaced `a21_`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `a21_profiles` | `id → auth.users`, plan, theme, default model | created lazily |
| `a21_projects` | owner, name (unique per owner), language, template, approval_mode, repo_url | archive/delete |
| `a21_workspaces` | project (unique), state, external_id, root_path, preview, resources | one sandbox per project |
| `a21_conversations` | project, owner, title | groups tasks |
| `a21_tasks` | conversation, prompt, model, status, progress, iteration, usage, cancel flag | status machine |
| `a21_messages` | task, role, JSONB content parts | Cline transcript |
| `a21_task_events` | bigserial, type, level, tool, JSONB payload | ordered live log |
| `a21_file_changes` | path, before/after, unified diff, status | inspect/revert |
| `a21_approvals` | tool, input, input hash, status | pause/resume |
| `a21_usage_records` | tokens, generated total, cost, pricing basis | metering |
| `a21_settings` | defaults, caps, timeout | enforced |
| `a21_provider_keys` | encrypted ciphertext/iv/tag, last4 | AES-256-GCM |
| `a21_jobs` | task (unique), status, lease, attempts, run_after | durable queue |
| `a21_rate_limits` | owner, action, window, count | atomic RPC |
| `a21_audit_logs` | owner, action, resource, metadata | no secrets |

Functions (service-role only): `a21_claim_job`, `a21_heartbeat_job`,
`a21_finish_job`, `a21_retry_job`, `a21_consume_rate_limit`, `a21_usage_summary`,
`a21_touch_updated_at`, `a21_handle_new_user`.

## 4. RLS and authorization

Two independent layers:

1. **API layer** — every route resolves the user from the session, then loads the
   resource with `owner_id = user.id`. Cross-user ids return 404. All writes use the
   service role only after that check.
2. **Database layer** — RLS is enabled on every table. `authenticated` has `SELECT`
   only on its own rows (policies use `auth.uid()`), and no `INSERT/UPDATE/DELETE`
   grants except the safe profile columns. `a21_jobs`, `a21_provider_keys`,
   `a21_rate_limits` and `a21_audit_logs` are not readable by clients at all.
   Anonymous has no grants.

The RLS test in `supabase/tests/rls.sql` creates fixtures for two users, acts as user A
and asserts one visible row and zero foreign rows per table. Negative tests assert
`ERROR 42501` for client inserts, task updates and reads of jobs/provider keys.

## 5. Secrets

- Server env only: service role, Daytona key, encryption key, worker secret, optional
  platform OpenRouter key.
- BYOK keys are encrypted before storage. The browser only ever sees `last4`.
- `sanitizeLogMessage` redacts `sk-or-*`, `dtn_*`, JWTs and bearer tokens before any
  error reaches logs, events or API responses.
- Sandbox env vars are limited to task metadata; no application credentials are
  injected.
- Prompt-injection defense: the system prompt marks repository files, command output and
  web content as untrusted data, forbids secret exfiltration and requires evidence for
  completion claims. Tool-level path and command guards enforce the boundary even if the
  model is persuaded.

## 6. Known failure modes

| Symptom | Cause | Behavior |
| --- | --- | --- |
| Tasks stay queued | No worker running / worker cannot reach DB | UI shows queued; start the worker |
| `sandbox_not_configured` | `DAYTONA_API_KEY` missing | 503 with operator message |
| `openrouter_not_configured` | No server key and no BYOK key | Task fails fast with instructions |
| Sandbox provisioning timeout | Daytona capacity/network | Workspace row marked `error`; retry from UI |
| Runtime install fails | apt unavailable in base image | Warning event; agent can still attempt language commands |
| Worker lease lost | Process pause > lease | Another worker may reclaim; task retried |
| Preview URL 502 | Nothing listening on the port | Start a dev server bound to `0.0.0.0` |

## 7. Deliberate non-goals

- No arbitrary user code on the app server.
- No long-running work inside serverless request handlers.
- No client-supplied ownership or quota fields.
- No simulated agent output, terminal output or diffs.
