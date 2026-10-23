# Account, onboarding and settings

Verification cases for the current Cloud-only iOS app. These are required observable behaviors, not claims of completed E2E coverage.

## Sub-features

- **AUTH-01 — Fresh install welcome and Cloud onboarding**.
- **AUTH-02 — First successful browser device authorization**.
- **AUTH-03 — Successful sign-in with remembered repository and slow account discovery**.
- **AUTH-04 — Returning user and token refresh**.
- **AUTH-05 — Cancel first-run sign-in / superseded completion**.
- **AUTH-06 — Saved-target authorization cancellation affordance**.
- **AUTH-07 — Slow pending browser auth / reopen URL**.
- **AUTH-08 — Authorization denied / expired / transport failure**.
- **AUTH-09 — Unmount or logout during pending auth/refresh**.
- **ACCOUNT-01 — Discover Personal and organization accounts**.
- **ACCOUNT-02 — Switch organization to Personal and back**.
- **ACCOUNT-03 — Retired account lookup cannot overwrite new selection**.
- **ACCOUNT-04 — Stale organization history permission**.
- **GITHUB-01 — No connection / no repositories onboarding**.
- **GITHUB-02 — Personal GitHub connect and browser return**.
- **GITHUB-03 — Organization member connect vs admin install**.
- **GITHUB-04 — Manage repository access / unsafe redirect / no permission**.
- **SETTINGS-01 — Account/settings navigation and sign out**.
- **SETTINGS-02 — Remove remembered Cloud workspace**.
- **SETTINGS-03 — Add Cloud workspace**.
- **DEFERRED-01 — Computer pairing/manual hub/approval settings hidden** (deferred feature: verify absence).
- **DEFERRED-02 — Integrations and desktop customization settings not shipped** (deferred feature: verify absence).
- **DEFER-02 — Local-only checkpoint fork and approval controls** (deferred feature: verify absence).
- **GITHUB-05 — Connect GitHub from chat error**.
- **APPEARANCE-01 — Follow system appearance**.
- **APPEARANCE-02 — Explicit appearance preference**.
- **APPEARANCE-03 — Appearance survives relaunch and upgrade**.
- **APPEARANCE-04 — Native sheets and keyboard**.
- **APPEARANCE-05 — Transcript and landscape contrast**.
- **APPEARANCE-06 — Native startup theme**.

## How to get to it (user POV)

Launch a fresh app for welcome/sign-in. Reach Settings from the Home header or sidebar. Account switch and workspace management live in Settings.

## Driving it with Maestro

Preconditions: run the skill doctor against the intended full app and use a private evidence directory. Select the cases whose fixtures are available; record unavailable fixtures as blocked.

### AUTH-01 — Fresh install welcome and Cloud onboarding

**Preconditions:** No credentials, targets or session history

**Actions:** Launch app → Tap Get started → Rotate portrait/landscape on welcome and setup

**Prove:** Centered Cline welcome then Cloud sign-in setup; Navigation remains reachable in short landscape; no computer choice

**Failure/recovery:** Startup/storage failure must not reveal an authenticated composer; inspect surfaced error

### AUTH-02 — First successful browser device authorization

**Preconditions:** Signed out; controlled Cline account

**Actions:** Tap Sign in to Cline → Complete browser credential login and device code confirmation → Return to app

**Prove:** Verification URL opens; native shows pending code; Credentials saved once; account lookup completes; repositories/history appear without second login

**Failure/recovery:** Denied/expired/network responses show actionable error; no credentials saved for abandoned flow

### AUTH-03 — Successful sign-in with remembered repository and slow account discovery

**Preconditions:** Signed out with saved Cloud target; account endpoint deliberately delayed

**Actions:** Tap Sign in → Complete authorization → Observe while accounts response remains pending → Allow response

**Prove:** Checking your Cline account shown; no active Sign in button after credential save; Transitions to Cloud composer once account scope resolves

**Failure/recovery:** Discovery failure must show retry/error rather than require a second authorization when token remains valid

### AUTH-04 — Returning user and token refresh

**Preconditions:** Credentials persisted; test both valid and refreshable expired access token

**Actions:** Force-close and reopen → Open Settings account

**Prove:** Restores account without browser authorization; Saved repository/model preferences retained

**Failure/recovery:** Invalid refresh produces sign-in recovery; transient error displayed without invented authenticated data

### AUTH-05 — Cancel first-run sign-in / superseded completion

**Preconditions:** First-run setup with authorization pending

**Actions:** Tap Cancel sign-in → Finish old browser authorization afterward → Return

**Prove:** Cancelled attempt cannot persist late credentials; Current UI remains signed out/current state

**Failure/recovery:** Start a fresh explicit attempt if wanted

### AUTH-06 — Saved-target authorization cancellation affordance

**Preconditions:** Signed out with saved target; browser authorization pending

**Actions:** Return to native waiting UI → Inspect available actions

**Prove:** Actual implementation offers Open browser again and waiting state; no dedicated Cancel in CloudOnboardingCard

**Failure/recovery:** Navigation/unmount retires flow; actionable Cancel parity is an identified UI gap, not a passing expectation

### AUTH-07 — Slow pending browser auth / reopen URL

**Preconditions:** Pending device grant

**Actions:** Wait through several poll intervals → Return before confirming → Tap Open browser again and finish original grant

**Prove:** Same pending code remains visible; reopen does not create a second grant; One current completion is persisted

**Failure/recovery:** Expired grant produces error; network timeout currently aborts poll and requires explicit retry

### AUTH-08 — Authorization denied / expired / transport failure

**Preconditions:** Controlled response fixture for access_denied, expired_token, timeout, unsafe URL

**Actions:** Start sign-in → Inject one failure at a time → Open technical details where offered → Retry

**Prove:** Readable error and valid recovery; unsafe non-HTTPS remote URL never auto-opens; No false signed-in state

**Failure/recovery:** New sign-in only when required; retry load for load failures

### AUTH-09 — Unmount or logout during pending auth/refresh

**Preconditions:** Authorization or credential refresh pending

**Actions:** Leave/unmount sign-in or sign out → Resolve old pending request

**Prove:** Late completion cannot restore removed credentials or write stale UI

**Failure/recovery:** Subsequent deliberate sign-in works

### ACCOUNT-01 — Discover Personal and organization accounts

**Preconditions:** Authenticated account with >1 available scope

**Actions:** Open Settings → Wait for Accounts list → Inspect active radio

**Prove:** Active server account indicated; names shown; Personal-only account hides redundant switcher

**Failure/recovery:** List failure shows Retry accounts

### ACCOUNT-02 — Switch organization to Personal and back

**Preconditions:** Two scopes with distinct saved repositories/models

**Actions:** Select another account in Settings → Tap again while pending → Return Home; open repository/branch → Switch back

**Prove:** One pending mutation; rows disabled; active selection updates after success; New-work repositories/model preference scoped correctly; stale branch selection not carried across scopes; History remains cross-account

**Failure/recovery:** Failed switch retains old active scope and readable error

### ACCOUNT-03 — Retired account lookup cannot overwrite new selection

**Preconditions:** Slow repo/branch/account response for prior scope

**Actions:** Start lookup → Switch scope → Resolve older response

**Prove:** Old repositories/branches disappear and cannot overwrite new scope; Manual account selection wins over earlier discovery

**Failure/recovery:** Retry discovery in current scope only

### ACCOUNT-04 — Stale organization history permission

**Preconditions:** Saved target belongs to no-longer-accessible organization; personal history available

**Actions:** Launch/refresh history

**Prove:** Accessible personal/other-scope sessions still load despite rejected old-org lookup

**Failure/recovery:** If primary personal request/auth fails show proper recovery; do not treat every scoped 403 as global sign-out

### GITHUB-01 — No connection / no repositories onboarding

**Preconditions:** Authenticated scope without GitHub or visible repositories

**Actions:** Open Home/setup → Read card → Tap Connect GitHub or Manage repository access

**Prove:** Actionable onboarding instead of disabled prompt telling user only to choose a repo; Signed install URL uses intended Personal/org scope

**Failure/recovery:** No token -> sign-in; org install forbidden -> admin-specific guidance

### GITHUB-02 — Personal GitHub connect and browser return

**Preconditions:** Personal scope; authorized disposable GitHub account/repo

**Actions:** Tap Connect GitHub → Complete GitHub authorization/install → Return to mobile

**Prove:** Repository list refreshes on foreground; selected account not silently changed; Available repository can be selected

**Failure/recovery:** Browser open failure remains visible; retry refresh when GitHub not completed

### GITHUB-03 — Organization member connect vs admin install

**Preconditions:** Org with integration installed; separate org without integration

**Actions:** As member connect existing org integration → As non-admin try org lacking integration → As authorized admin complete install

**Prove:** Existing integration uses member connect route; Missing integration uses install route; 403 clearly says admin required; Same org used for subsequent repository lookup

**Failure/recovery:** No fallback to Personal or another organization

### GITHUB-04 — Manage repository access / unsafe redirect / no permission

**Preconditions:** Connected integration but desired repo absent; controlled failed/unsafe responses

**Actions:** Open Manage repository access → Return after permission change → Retry disallowed case

**Prove:** Action-specific add-repositories URL; only HTTPS github.com accepted; Refresh reveals newly granted repos

**Failure/recovery:** Reject unsafe URL/unexpected response; retain error instead of guessed dashboard redirect

### SETTINGS-01 — Account/settings navigation and sign out

**Preconditions:** Authenticated; optional running Cloud session

**Actions:** Open Settings from Home and sidebar → Inspect account → Tap Sign out → Reopen app

**Prove:** Credentials removed; returns to sign-in; retained viewers/start jobs cleared; Remote sessions continue; prefs are not remote deletion

**Failure/recovery:** Late refresh/provision result cannot reauthenticate or launch discarded prompt

### SETTINGS-02 — Remove remembered Cloud workspace

**Preconditions:** Saved Cloud target and independent remote session

**Actions:** Tap Remove Cloud workspace → Cancel once → Repeat and confirm Remove

**Prove:** Cancel leaves target; Remove deletes only device remembered target; Remote sessions/history remain intact

**Failure/recovery:** No server deletion request for target removal

### SETTINGS-03 — Add Cloud workspace

**Preconditions:** Authenticated with existing targets

**Actions:** Settings -> Add Cloud workspace → Choose repository/model → Return Home

**Prove:** Uses same first-class Cloud configuration; saves target preference

**Failure/recovery:** Save failure keeps setup open with message

### DEFERRED-01 — Computer pairing/manual hub/approval settings hidden

**Preconditions:** Production release flags

**Actions:** Inspect onboarding, target picker, Settings → Try deferred direct route only in controlled navigation test

**Prove:** No My computer, QR pairing/manual hub or local approval UI in release

**Failure/recovery:** Deferred entry points stay gated; do not treat mocked flag-enabled tests as production coverage

### DEFERRED-02 — Integrations and desktop customization settings not shipped

**Preconditions:** Current production build

**Actions:** Inspect Settings

**Prove:** Native general connector catalog/Composio management, MCP/rules/skills/hooks and desktop customization panes are absent

**Failure/recovery:** Do not include as executable shipped flows; backend feasibility research is not implementation

### DEFER-02 — Local-only checkpoint fork and approval controls

**Preconditions:** Production cloud chat

**Actions:** Inspect model settings and account settings.

**Prove:** Local-only Fork/auto-approval settings are not presented as supported Cloud features.

### GITHUB-05 — Connect GitHub from chat error

**Preconditions:** Controlled cloud session blocked specifically by missing GitHub integration

**Actions:** Tap Connect GitHub on chat error; inspect browser destination; return to app.

**Prove:** Opens the integration dashboard (current distinct path); record any extra browser login and whether session recovery refreshes. Do not conflate with Home signed installation URL flow.

### APPEARANCE-01 — Follow system appearance

**Preconditions:** Fresh installation; OS light then dark

**Actions:** Open welcome; change OS appearance while foreground and background; return

**Prove:** Welcome, setup, home and native status bars follow the phone without sign-in or lost state.

### APPEARANCE-02 — Explicit appearance preference

**Preconditions:** Settings reachable

**Actions:** Choose Light; choose Dark; select System

**Prove:** Selection updates all screens immediately; system setting is ignored for explicit overrides and followed again for System.

### APPEARANCE-03 — Appearance survives relaunch and upgrade

**Preconditions:** Saved explicit Light or Dark

**Actions:** Terminate and reopen; install next build without removing data

**Prove:** Saved choice and authentication survive; selected control matches the rendered theme.

### APPEARANCE-04 — Native sheets and keyboard

**Preconditions:** Signed-in Home and accessible chat in both themes

**Actions:** Open keyboard, repository and model sheets, attachment menu; dismiss each

**Prove:** Keyboard, input text, sheets and action menus match the active theme; draft remains intact.

### APPEARANCE-05 — Transcript and landscape contrast

**Preconditions:** Accessible existing chat; both themes

**Actions:** Read transcript, status labels and tools; rotate both directions; open sidebar and Settings

**Prove:** Readable text and accents on all surfaces; logo size and layout remain consistent; no cropped controls.

### APPEARANCE-06 — Native startup theme

**Preconditions:** System preference; cold app; OS light then dark

**Actions:** Cold launch in each OS mode

**Prove:** Native splash and in-app startup use the corresponding canvas and matching Cline artwork; no Loading Cline text.

## Gotchas

Use an isolated simulator for fresh state, sign-out and permissions. Complete browser authentication only with the designated test account. Some failure cases require controlled network responses.

Run all distinct entry points named above. Evidence must include the actions and resulting state. Track pass/fail/partial/blocked/not-run separately; an automated unit test is not a substitute for this user path.
