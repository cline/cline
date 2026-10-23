# Repositories and Cloud session lifecycle

Verification cases for the current Cloud-only iOS app. These are required observable behaviors, not claims of completed E2E coverage.

## Sub-features

- **REPO-01 — Select repository before first prompt**.
- **REPO-02 — Browse/search repositories incl long list**.
- **REPO-03 — Default and explicit branch / branch search**.
- **PREF-01 — Repository/model preference across relaunch and scopes**.
- **SESSION-01 — Create and automatically submit one Cloud task**.
- **SESSION-02 — Provisioning background/navigation and independent starts**.
- **SESSION-03 — Known create/provision failure and retry**.
- **SESSION-04 — Unknown create outcome / explicit recovery**.
- **SESSION-05 — Process eviction during provisioning / pending first input**.
- **SESSION-06 — Sign out while provisioning**.
- **SESSION-07 — Existing session without new-work setup**.
- **SESSION-08 — Sidebar refresh/status/unread and foreground**.
- **SESSION-09 — Rename exact scoped session**.
- **SESSION-10 — Stop workspace confirmation / cancel / failure**.
- **SESSION-11 — Resume paused workspace and preserved conversation**.
- **SESSION-12 — Resume cancellation / concurrent viewer race**.
- **SESSION-13 — Terminal session archive/read-only history**.
- **SESSION-14 — Archive navigation race**.
- **SESSION-15 — Delete session confirmation / cancel / server rejection**.
- **SESSION-16 — Connection failure and expired identity recovery**.

## How to get to it (user POV)

Use the Home Cloud context control for repositories and branches. Send creates a workspace; sidebar rows open existing sessions. Long-press a test row for Rename, Stop or Delete.

## Driving it with Maestro

Preconditions: run the skill doctor against the intended full app and use a private evidence directory. Select the cases whose fixtures are available; record unavailable fixtures as blocked.

### REPO-01 — Select repository before first prompt

**Preconditions:** Authenticated, repositories available, no target selected

**Actions:** Type draft → Tap Send → Choose repository in opened sheet

**Prove:** Sheet explains repo prerequisite; selected target saved; Draft remains; choosing repo alone does not submit prompt

**Failure/recovery:** Dismiss picker preserves draft; load failure is retryable

### REPO-02 — Browse/search repositories incl long list

**Preconditions:** Account has >30 repositories

**Actions:** Open repo picker → Scroll below first 30 → Search and select desired repo

**Prove:** All returned repos reachable; correct selected label; Picker concerns repos, not hidden account switching

**Failure/recovery:** No-match and load failure remain distinguishable

### REPO-03 — Default and explicit branch / branch search

**Preconditions:** Selected repository; default and non-default branches

**Actions:** Open branch picker → Search branch outside first API page → Select explicit branch → Choose default again → Switch repository

**Prove:** Server-wide search; stable sheet during loading/keyboard; Explicit branch persists; default is represented by absent override; switching repo clears incompatible branch

**Failure/recovery:** No results/error shown; stale branch response from previous account ignored

### PREF-01 — Repository/model preference across relaunch and scopes

**Preconditions:** At least two repos and two account scopes

**Actions:** Select repo/model → Select another model before repo if applicable → Force-close/reopen → Switch account and back

**Prove:** Selected repo restored; model follows per-account preference across that account repos; Other account preference unchanged; serialized writes cannot restore older choice

**Failure/recovery:** Corrupt stored rows dropped without inventing usable target

### SESSION-01 — Create and automatically submit one Cloud task

**Preconditions:** Authenticated scoped repo/model; approved disposable test repo

**Actions:** Enter synthetic prompt → Tap Send once → Observe provisional thread then ready chat

**Prove:** Immediate prompt bubble; resumable workspace provisioned; Correct repo/branch/account/model used; first prompt delivered once; ready route retains same conversation

**Failure/recovery:** Creation/auth/provision failure preserves recoverable submission as appropriate

### SESSION-02 — Provisioning background/navigation and independent starts

**Preconditions:** Create response/provisioning intentionally delayed

**Actions:** Start task A → Open sidebar/return Home before ready → Start task B → Open A when ready

**Prove:** A continues while away; B independent; each retains own prompt/progress; No duplicate initial send when attaching viewer

**Failure/recovery:** Back is not cancellation and must not imply remote workspace stopped

### SESSION-03 — Known create/provision failure and retry

**Preconditions:** Deterministic recoverable failure; creation ID may already be known

**Actions:** Start task → Observe failure → Tap Try again

**Prove:** Retains exact job submission/scope; When server ID known, retry continues that workspace rather than creates duplicate

**Failure/recovery:** 401 -> Back to sign in; retry after auth, never futile immediate repeated auth failure

### SESSION-04 — Unknown create outcome / explicit recovery

**Preconditions:** Create accepted server-side but response lost; controlled fixture

**Actions:** Send → Observe unknown-result error → Tap Check sessions → Select matching account/repo workspace and approve recovery

**Prove:** No automatic create retry; Only scoped repo candidates offered; user selects exact workspace before recovered prompt dispatch

**Failure/recovery:** Wrong-account/repo or terminal session cannot claim retained prompt; abandon/retry only with explicit intent

### SESSION-05 — Process eviction during provisioning / pending first input

**Preconditions:** Known remote ID stored after create; synthetic task

**Actions:** Start task → Terminate app before provisioning finishes → Relaunch and open matching history row

**Prove:** Stored descriptor recovers original workspace; existing canonical task reused; No initial prompt duplicated if durable resend intent was already cleared

**Failure/recovery:** Process-local unknown-create job may be lost; missing cloud-start route shows Home/history recovery, not fabricated job

### SESSION-06 — Sign out while provisioning

**Preconditions:** Pending job and authenticated account

**Actions:** Sign out before provisioning completes → Resolve job

**Prove:** Late completion cannot open/send discarded prompt; Server workspace creation itself may continue; no unsupported cancel guarantee

**Failure/recovery:** Sign in and inspect history if workspace was created

### SESSION-07 — Existing session without new-work setup

**Preconditions:** Authenticated with existing Cloud history but no remembered repo target

**Actions:** Open existing history row

**Prove:** Opens exact session without forcing GitHub/repo/model onboarding

**Failure/recovery:** Unavailable workspace offers retry/history according to status, not silently new session

### SESSION-08 — Sidebar refresh/status/unread and foreground

**Preconditions:** Several sessions including a running background conversation

**Actions:** Open sidebar → Wait for update → Background app then foreground → Open completed/unread session

**Prove:** Visible history refresh preserves rows; no overlapping/background interval loads; Live opened-session status overrides stale history; new activity marks unread and opening clears it

**Failure/recovery:** Failure shows message with cached rows; stale data never opens different session

### SESSION-09 — Rename exact scoped session

**Preconditions:** Disposable Cloud session

**Actions:** Open row menu -> Rename session → Enter whitespace then valid name → Save title

**Prove:** Empty name cannot save; exact outer session/account renamed; inner conversation identity retained

**Failure/recovery:** API failure remains in dialog; local persistence failure after server success must not invite duplicate mutation

### SESSION-10 — Stop workspace confirmation / cancel / failure

**Preconditions:** Running resumable disposable workspace

**Actions:** Open menu -> Stop workspace → Cancel once → Confirm stop → Open session again

**Prove:** Cancel no mutation; stop preserves files/conversation and retires live viewer only after success; Paused status; opening resumes same workspace

**Failure/recovery:** Failed stop leaves viewer/row intact; error in dialog

### SESSION-11 — Resume paused workspace and preserved conversation

**Preconditions:** Suspended resumable workspace with messages/files

**Actions:** Open paused history row → Wait for provisioning → Read previous messages → Send continuation

**Prove:** Status check then resume only if needed; no socket before ready; Same canonical task, files and history; no resend of original prompt

**Failure/recovery:** Quota/auth rejection stays error; no replacement workspace created

### SESSION-12 — Resume cancellation / concurrent viewer race

**Preconditions:** Paused saved task; controlled delayed resume/history

**Actions:** Open then leave while resume/history pending → Separately open same task from two viewers

**Prove:** Leaving prevents late task creation/navigation; Concurrent restore handles already-exists by probing same task

**Failure/recovery:** Wrong/missing canonical task errors; never choose newer child task or recreate pinned missing task

### SESSION-13 — Terminal session archive/read-only history

**Preconditions:** Ended/expired/failed workspace with known saved history fixture

**Actions:** Open history row → Scroll messages → Tap the header's New session (+) action if desired

**Prove:** Reads exact scoped REST history; no live runtime attachment; Read-only banner; no composer execution against ended workspace

**Failure/recovery:** No history vs empty history vs malformed rows explained distinctly; retry read error; auth error links sign-in

### SESSION-14 — Archive navigation race

**Preconditions:** Two distinct archived conversations; first read delayed

**Actions:** Open A then B → Resolve A last

**Prove:** B remains displayed; late A cannot overwrite

**Failure/recovery:** Retry belongs to current descriptor only

### SESSION-15 — Delete session confirmation / cancel / server rejection

**Preconditions:** Disposable Cloud session only; explicit deletion authorized

**Actions:** Menu -> Delete session → Cancel once → Repeat -> Confirm delete → Refresh history

**Prove:** Cancel preserves session; success removes exact server workspace/history, saved endpoint and retained viewer

**Failure/recovery:** Server failure keeps local state/navigation; no optimistic disappearance

### SESSION-16 — Connection failure and expired identity recovery

**Preconditions:** Controlled unavailable workspace/auth failure

**Actions:** Open selected session → Observe error → Use Retry / Sign in / choose another as offered

**Prove:** Readable cause-specific action; technical details optional; Same intended session retried; no unintended new workspace

**Failure/recovery:** Read-only history for ended workspace; sign-in for credential expiry

## Gotchas

A designated disposable repository/session is required for mutations. Back from provisioning does not cancel the server job. Stopped, archived, resumable and unknown-create outcomes are distinct fixtures.

Run all distinct entry points named above. Evidence must include the actions and resulting state. Track pass/fail/partial/blocked/not-run separately; an automated unit test is not a substitute for this user path.
