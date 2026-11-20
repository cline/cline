# 21 Agent

**21 Agent** is a premium cloud AI coding platform. You describe a task; a real agent
inspects files, plans, edits code, installs dependencies, runs commands and tests inside
an isolated [Daytona](https://www.daytona.io/) sandbox, and reports what actually
happened.

It is not a landing page or a mocked demo. The dashboard, workspace, terminal, diffs,
task log, approvals and usage screens are wired to the same APIs the worker uses.

![stack](https://img.shields.io/badge/agent-Cline%20runtime-d3fa6a)
![sandboxes](https://img.shields.io/badge/execution-Daytona-6ee7c8)
![models](https://img.shields.io/badge/models-OpenRouter-a78bfa)
![db](https://img.shields.io/badge/auth%20%26%20db-Supabase-3ecf8e)

## Why it exists

Most "AI coding" products show a chat transcript and ask you to trust it. 21 Agent is
built around evidence:

- **Real execution.** `run_command` calls a live Linux sandbox and returns real exit
  codes, stdout and stderr.
- **Real diffs.** Every write records before/after content and a unified diff in
  Postgres; changes can be inspected and reverted.
- **Honest summaries.** The agent must call `finish_task`; the system prompt forbids
  claiming tests passed without tool evidence, and the UI shows the underlying events.
- **Isolation.** Untrusted code never runs on the Next.js server. Each project gets a
  Daytona sandbox scoped to one owner.

## Architecture

```
Browser (Next.js 15 App Router / React 19)
   │  Supabase session cookies (SSR)
   ▼
Vercel — web + API routes ──────────────┐
   │  service-role writes after authz   │  reads: user RLS
   ▼                                    ▼
Supabase Postgres  ◄──────────────  Supabase Auth
   │  a21_jobs (claim / lease / retry)
   ▼
Worker (long-lived Node process, `npm run worker`)
   │  @cline/agents runtime + OpenRouter
   ▼
Daytona sandbox (per project, per owner)
   ├── filesystem (real files, deps, builds)
   ├── shell sessions (streamed logs)
   └── preview URLs
```

The web tier never executes user code and never waits on a long agent run. Task
execution is owned by the worker through a Postgres-backed durable queue. See
[`docs/architecture.md`](docs/architecture.md) for the full flow, data model and
security boundaries.

## Feature map

| Area | What is implemented |
| --- | --- |
| Auth | Email/password signup, sign-in, email verification, password recovery, logout, protected routes, SSR session refresh |
| Dashboard | Projects, recent tasks, live activity, token/cost meters, plan limits |
| Projects | Create (10 language templates, optional public Git clone), archive, delete, per-project approval mode |
| Workspace | Chat-style task composer, model picker, file explorer, CodeMirror editor, save/delete files, terminal, unified diffs, revert, preview links |
| Tasks | Durable queue, live event polling, progress, iteration count, tool calls, token/cost usage, cancel, retries, failure detail |
| Approvals | Pause before writes/commands when configured; approve resumes at the approved action, reject stops |
| Models | Live OpenRouter catalog with provider/context/tool filtering, per-task selection, pricing and cost estimation |
| Usage | Monthly tokens, per-model breakdown, daily chart, recent metered records, plan + personal caps |
| Settings | Display name, default model, concurrency, terminal timeout, personal monthly caps, encrypted BYOK OpenRouter key |
| Security | RLS on every `a21_*` table, service-role-only mutations, ownership checks on every endpoint, rate limits, quotas, audit logs, secret redaction |

## Repository layout

```
platform/
├── src/app/              App Router pages + API routes
│   ├── app/              authenticated workspace (dashboard, projects, tasks, usage, settings)
│   ├── (auth)/           sign-in, sign-up, recovery, verification
│   └── api/              JSON APIs (authz + validation + rate limits)
├── src/components/       workspace, task live view, settings, auth forms, UI primitives
├── src/lib/
│   ├── agent/            Cline runtime wiring, tools, event log, system prompt
│   ├── sandbox/          Daytona provider, path/command guards, templates, runtime setup
│   ├── openrouter/       model discovery, pricing, error classification, key resolution
│   └── supabase/         SSR/browser/service clients + middleware refresh
├── worker/               long-lived claim loop (`npm run worker`)
├── supabase/migrations/  0001 schema, 0002 RLS, 0003 functions
├── supabase/tests/       cross-user isolation SQL
├── tests/                Vitest suites
└── docs/                 architecture, deployment, security notes
```

## Local development

Requirements: Node.js **22+**, npm, a Supabase project, a Daytona API key
([dashboard](https://app.daytona.io/dashboard/keys)) and preferably an OpenRouter key
([keys](https://openrouter.ai/keys)). Users can also bring their own OpenRouter key in
Settings.

```bash
cd platform
npm install
cp .env.example .env.local     # fill in values
npm run dev                    # http://localhost:3000
npm run worker                 # in a second terminal
```

Apply the schema. Either use the Supabase CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

…or paste the three files from `supabase/migrations/` into the SQL editor in order.
The migration files contain the exact statements that were applied to the shared
project used during development.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Browser-safe anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only API/worker writes (never expose) |
| `DAYTONA_API_KEY` | yes | Real sandbox provisioning |
| `DAYTONA_API_URL` | no | Defaults to `https://app.daytona.io/api` |
| `DAYTONA_TARGET` | no | Daytona target region |
| `OPENROUTER_API_KEY` | recommended | Platform fallback model key; users can BYOK instead |
| `OPENROUTER_BASE_URL` | no | Defaults to `https://openrouter.ai/api/v1` |
| `APP_URL` / `OPENROUTER_SITE_URL` | yes in prod | Public origin used for auth redirects and OpenRouter attribution |
| `ENCRYPTION_KEY` | yes for BYOK | base64 32 bytes (`openssl rand -base64 32`) |
| `WORKER_INTERNAL_SECRET` | yes in prod | Bearer secret for `/api/internal/*` |
| `WORKER_LEASE_SECONDS` | no | Queue lease, default 120 |
| `WORKER_POLL_MS` | no | Queue poll interval, default 1500 |

`npm run build` validates imported config lazily at request time; a missing key is
reported in the UI rather than crashing the whole app.

## Running tests

```bash
npm run typecheck        # tsc --noEmit
npm test                 # 34 unit tests (vitest)
npm run lint             # biome check
npm run build            # production build
```

The **cross-user isolation** suite is a SQL script because it needs two real
`auth.users` rows and database roles:

```bash
psql "$DATABASE_URL" -f supabase/tests/rls.sql
```

Replace the two user ids in the script. Expected result: user A sees 1 row per table,
0 rows owned by user B. Negative checks are documented at the bottom of the file:
authenticated users cannot insert projects, read jobs/provider keys, or update tasks
(`ERROR 42501`).

## Deployment

1. **Vercel** — import the repository with root directory `platform/`. Add every
   server-side env var above (Production + Preview). The API routes are Node runtime.
2. **Database** — apply migrations once against the Supabase project.
3. **Worker** — deploy `npm run worker` to any long-lived host (Fly.io, Railway, Render,
   a VM, Docker). It needs the same env vars, especially the service role key, Daytona
   key, encryption key and `OPENROUTER_API_KEY`.
4. **Auth URLs** — add `https://<your-domain>/auth/callback` to Supabase →
   Authentication → URL Configuration → Redirect URLs, and set the Site URL to your
   production origin. Email delivery requires SMTP configuration in Supabase.
5. **Verify** — call `GET /api/internal/health?deep=1` with
   `Authorization: Bearer $WORKER_INTERNAL_SECRET`. It checks Postgres, OpenRouter model
   discovery and Daytona connectivity. `POST /api/internal/smoke/daytona` creates and
   deletes a real sandbox and returns file I/O and command results.

A serverless cron may call `POST /api/internal/tick` for recovery, but long agent runs
must not rely on it — Vercel functions are time-limited. The standalone worker is the
supported execution path.

## Security model (short version)

- Anonymous and authenticated roles can **only read their own rows**; every mutation
  goes through the API or worker using the service role **after** an ownership check.
- Client-supplied owner ids, roles, plans and limits are never trusted; they are read
  from the session/profile server-side.
- API keys stay server-side. User BYOK keys are validated with OpenRouter and encrypted
  with AES-256-GCM; only the last four characters are ever returned.
- Agent tools reject absolute paths and traversal; dangerous shell commands are blocked
  before they reach the sandbox.
- Logs and event payloads pass through secret redaction (OpenRouter keys, Daytona keys,
  JWTs, bearer tokens).
- The sandbox never receives application secrets, and the agent is instructed to treat
  repository content as untrusted data.

## Honest limitations

- **Worker hosting is required.** Vercel is used for web/API only. Without a running
  worker, tasks stay `queued`.
- **OpenRouter key needed for model calls.** Without a server key or a user BYOK key,
  sandbox provisioning and manual terminal/file access still work, but tasks fail with a
  configuration message.
- **Email delivery** depends on Supabase SMTP. With no SMTP provider configured, signup
  emails are not delivered and accounts must be confirmed manually in Supabase.
- **GitHub OAuth is not configured.** Public repos can be cloned by HTTPS into the
  sandbox; private repositories and PR creation require credentials/OAuth setup.
- **Previews are public URLs** issued by Daytona (port-scoped). Treat them as
  shareable secrets; do not run production data in a sandbox.
- **Sandbox persistence** is subject to Daytona's auto-stop/archive intervals. Files can
  disappear if a sandbox is archived/deleted; task history and diffs remain in Postgres.
- **Costs are estimates** unless OpenRouter reports a total; they are not an invoice.
- **Cross-language runtime installation** depends on `apt-get` availability and can take
  minutes for compiled languages.

## Attribution & license

The agent loop, message model, tool-calling protocol and approval semantics are built on
the **Cline** open-source agent runtime (`@cline/agents` / `@cline/shared`, Apache-2.0):
https://github.com/cline/cline. See [`NOTICE`](NOTICE).

21 Agent is distributed under the Apache-2.0 license in the repository root. "21 Agent"
branding, UI and platform code are original to this project. Cline's name and marks
belong to their owners; this project does not claim affiliation.
