# QA Agent 4: does PR #13799's shared `@cline/core` change touch the desktop app and the CLI?

**Answer:** For the CLI, and for the desktop app with cloud sessions **off**, nothing changed. Every cell matches baseline and the local Hub never goes through a proxy. For the desktop app with cloud sessions **on**, the change is a clear improvement with HTTP(S) proxies: behind a proxy-only network, baseline cloud sessions fail and RC sessions work. There is one real regression: `ALL_PROXY` is now honored by the session socket, while every REST call still ignores it. There is also one intermittent recovery problem after a proxy outage that RC makes much more likely.

## 1. Setup facts

| Item | Value |
|---|---|
| RC | PR head `fff1c7356` (`saoudrizwan/vscode-cloud-sessions-f236`), worktree build |
| Baseline | merge-base `c269dbb7f` = "chore(desktop): release v0.0.42". It is identical to RC except for the PR, so it isolates the PR's effect |
| Published CLI | `cline@3.0.68` + `@cline/cli-linux-x64@3.0.68` from npm |
| Runtimes | Desktop sidecar on **Bun 1.4.2**, the version `desktop-publish.yml` ships (the VM's own Bun is 1.3.13 and was used only for comparison probes). CLI as the compiled Bun binary (`script/build.ts --single`, Bun 1.4.2), the shape that ships on npm. Node 22.22.2 for Node-side probes |
| OS | Ubuntu 24.04 (Linux 6.12, x64), cloud VM, headless display `:1` |
| Desktop mode | Plain web mode (Next.js UI on `:3125` + Bun sidecar on `:3126`). Native Tauri shell not exercised |
| Auth | Desktop: onboarding → "Use a Cline API key" (GUI, worked). CLI: `CLINE_API_KEY` for one-shot, `cline auth cline --apikey` for the TUI (the TUI ignores `CLINE_API_KEY` and shows device sign-in) |
| Cloud flag | `code-cloud-agents` is always false in dev builds (PostHog needs `TELEMETRY_SERVICE_API_KEY`, which is inlined only in release builds), so the Settings toggle could not be tested on its own. Used the documented override `CLINE_CODE_CLOUD_AGENTS=1/0`. Settings showed: "Cloud sessions are currently enabled by the CLINE_CODE_CLOUD_AGENTS environment override, which takes precedence over this setting." |
| Proxies | tinyproxy 1.11: open (`:8888`), basic-auth (`:8889`), and a "strict" proxy (`:8891`) that is the only path to a cloud endpoint which refuses direct connections. Plus a Node CONNECT proxy (`:8890`) that logs CONNECT headers, and a TLS origin (`:7444`) that logs upgrade headers |
| Wall time | about 2h05m (21:45 to 23:50 UTC) |

**Cloud environment.** The account has no GitHub integration on any org (`412 GitHub is not connected for this account`). I could not install the GitHub App because I have no GitHub web login, and no scratch repo was provided. So production cloud sessions stop at create, on both builds. For full cloud flows I used the PR's own fixture (`apps/vscode/src/dev/local-cloud-server.ts`) behind a real TLS front at `https://qa-cloud.test:7443`. That host is non-loopback, so the sidecar's automatic loopback `NO_PROXY` doesn't bypass the proxy. The fixture gives the real REST plus `wss` Hub-proxy path with a scripted model. I patched my local copy of the fixture to serve `/api/v1/ai/cline/models` (captured from production), because the desktop composer needs it; this is test infrastructure only and was not committed. I also hit the real `wss://api.cline.bot/api/v1/session/<id>` endpoint directly with the built `NodeHubClient`.

**Cloud session ids.** Production: none were created (the one create probe was rejected with 412; org and personal session lists show no sessions created today). Fixture (local, in-memory, no real sandboxes): 61 ids, for example `ses-6915e58e-8f69-490f-be6f-686127ab0640` (SOCKS regression), `ses-503d46c0-1e9e-460c-a99b-ac60d99ba315` (baseline strict-proxy failure), `ses-e7707172-fb67-4d67-8cb3-0218bbaf51b1` (RC strict-proxy success), `ses-29a1d6d9-70da-4e65-a425-7f80914e3bf0` (unrecoverable after proxy outage).

## 2. P0

None found. The local Hub was reachable and never proxied in any CLI or desktop run (more than 100 runs). Cloud behavior never leaked to opted-out users: with cloud off, `cloudAgents:false` and the composer marks the CLOUD option "Coming soon". I saw no crash and no credential leak (section 6).

## 3. P1

### P1-1: `ALL_PROXY` set to SOCKS (or stale) breaks desktop cloud sessions that work on baseline, after the sandbox is already created

RC regression.

- **Steps:** Launch the desktop sidecar with `ALL_PROXY=socks5://127.0.0.1:1080` and no `HTTPS_PROXY`. Enable cloud. Start a cloud session on `cline/fixture` and send a prompt.
- **Expected:** Same as baseline (works), or a refusal before any sandbox is provisioned.
- **Actual (RC):** The REST create succeeds because Bun `fetch` ignores `ALL_PROXY`, so the session row appears in the sidebar. Then the socket fails with the banner **"The run failed: Unsupported proxy protocol "socks5" (expected "http" or "https")"**. There is no Retry, and every new attempt provisions another session. The same happens with an unreachable `ALL_PROXY=http://127.0.0.1:1`, which shows "WebSocket connection to 'wss://…' failed: Failed to connect".
- **Baseline:** Works 3/3 because its socket ignores `ALL_PROXY`.
- **Frequency:** RC SOCKS 3/3 (2 scripted + 1 GUI); RC stale-HTTP `ALL_PROXY` 1/1. A Clash-style environment (`https_proxy` + `http_proxy` + `all_proxy=socks5`) works on RC because `https_proxy` wins.
- **Root cause, as observed:** `proxy-from-env` honors `ALL_PROXY` and `http(s)-proxy-agent` can't speak SOCKS, while Bun `fetch` ignores `ALL_PROXY`. So REST and the socket disagree. Under Bun 1.4.2 the SOCKS error is a raw `SyntaxError` with no `hub_connect_failed` code; under Bun 1.3.13 it is "Failed to connect".
- **Workaround:** Unset `ALL_PROXY`, or set `HTTPS_PROXY`, or set `NO_PROXY=api.cline.bot`.
- **Evidence:** `logs/qa4-desk-cloud-summary.log` (cells `fx-allproxy-socks`, `fx-socks-repeat`, `fx-allproxy-bogus`), `logs/qa4-probe-fixture.log` (`[socks]`), screenshot `qa4-allproxy-socks5-regression.png`.

### P1-2: after a proxy outage, a cloud session that was touched during the outage can stay unusable

RC makes this much more likely; the underlying mechanism also exists on baseline.

- **Steps:** Run a cloud session through `HTTPS_PROXY`. Kill the proxy. While it is down, send a message or re-open the session (the webview re-attaches). Restore the proxy and send again.
- **Expected:** The session reconnects about 3s after the proxy returns, which is what happens when nothing touches the session during the outage (RC 4/4).
- **Actual:** The session stays failed with **"The run failed: This cloud session's task is unavailable. Start a new cloud session to continue."** The transcript pane is empty and survives a page reload empty. During the outage the banner is the generic "Unable to connect. Is the computer able to access the url?" (duplicated), and the send spinner runs for 45s or more.
- **Frequency:**
  - RC proxy outage + re-attach: **5/8 scripted, 1/1 GUI**.
  - RC plain network outage (TLS front killed, no proxy) + re-attach: 0/5.
  - Baseline network outage + re-attach: 1/5.
  - Baseline is immune to proxy outages because its socket bypasses the proxy (its follow-up during a proxy outage succeeded).
- **Analysis and caveat:** In the runs that recover, the client's background reconnect rehydrates within about 3s. In the failing runs no background reconnect happens, so the next user action goes through a fresh attach. That path resolves the inner task by `metadata.taskId`, which the PR's fixture doesn't map. The same gap makes reopen-after-app-restart fail on **both** builds. Production may therefore recover through the fresh attach; I could not verify that without GitHub. The RC-specific part is that the background reconnect loop doesn't resume after a proxy outage in most runs. This should be checked against production before release.
- **Evidence:** `logs/qa4-outage-samples.log`, `logs/qa4-scenario-rc-attachdown.jsonl` vs `logs/qa4-scenario-od-rc-net-1.jsonl` (the latter shows `cloud_session_rehydrated` at 12.9s), screenshots `qa4-proxy-outage-during-session.png` and `qa4-after-proxy-restored-task-unavailable.png`.

## 4. P2

- **Proxy failures don't say "proxy".** RC socket errors: bogus or dead proxy gives "Failed to connect" (Bun) or "connect ECONNREFUSED 127.0.0.1:1" (Node). A 407 from the proxy gives "Proxy connection failed" with no status (Bun) or **"Unexpected server response: 407"** (Node, which blames the server). The REST side (both builds) gives "Unable to connect. Is the computer able to access the url?". None of these tells the user to check `HTTPS_PROXY`.
- **Bogus proxy takes about 62s to fail a local turn.** This is the same in RC, baseline, and published (CLI one-shot, TUI, and desktop local task: 62–63s, "Cannot connect to API: Unable to connect…"). It is pre-existing and listed only because it is the user-visible failure under a bad proxy. The app stays usable.
- **Duplicate stacked error banners** in the desktop chat during an outage (screenshots).
- **No Retry on the SOCKS failure.** Each manual retry starts a new cloud session, so sandboxes accumulate in the list (see P1-1).

## 5. P3

- **PR test coverage.** The `connection-headers.test.ts` Bun leg covers only `ws://`, and its comment says Bun has no `NODE_EXTRA_CA_CERTS` equivalent. In practice Bun 1.3.13 and 1.4.2 both honored `NODE_EXTRA_CA_CERTS`, and `wss` through CONNECT worked (desktop and probes). A Bun + `wss` leg is cheap to add and would cover the shipping desktop path.
- **Normalize errors.** Wrap socket construction so errors like the Bun 1.4.2 SOCKS `SyntaxError` become a `HubTransportError` code, and consider rejecting unsupported proxy schemes up front with a proxy-specific message.
- **Align proxy resolution.** Consider making the socket's proxy resolution match what Bun `fetch` does (ignore `ALL_PROXY`, or teach both to honor it the same way). This would fix P1-1 at the root.
- **Diagnostics.** Exports don't record the `CLINE_CODE_CLOUD_AGENTS` override (they show `cloudSessionsEnabled:false` while cloud is forced on), nor whether proxy variables are set (presence only, no values). Both would help support.
- **Hub environment (pre-existing, identical in all builds).** The shared Hub keeps the proxy environment of whichever process spawned it. A CLI run with a bogus proxy succeeds if a no-proxy Hub is already warm (4/4 RC, 4/4 baseline). Worth documenting for proxy users.

## 6. Covered / not covered

**Matrix.** Result plus proxy-log evidence. Unless a cell says "differs", RC, baseline, and published behaved identically. "CONNECT x" means a tinyproxy log line `CONNECT x HTTP/1.1`. The local Hub (`127.0.0.1:25463`) and sidecar (`:3126`) appeared in **zero** proxy log lines across all runs.

| Proxy env | CLI one-shot / TUI / 2 CLIs on 1 Hub (RC, base, pub) | Desktop cloud OFF, local task (RC, base) | Desktop cloud ON, production API (RC, base) | Desktop cloud ON, fixture `qa-cloud.test` (RC vs base) |
|---|---|---|---|---|
| none | PONG; no proxy lines; Hub direct | PONG + follow-up; Hub `connected`; no proxy lines | Create fails at the GitHub check (412 `github_not_connected`), identical | Start, stream, follow-up OK both; no proxy lines |
| `HTTP(S)_PROXY` real | PONG; `CONNECT api.cline.bot:443` | PONG; `CONNECT api.cline.bot:443` ×2, `models.dev` | Same 412; `CONNECT api.cline.bot:443` (REST) | Both OK. **Differs:** RC `CONNECT qa-cloud.test:7443` ×2–3 (REST + socket); base ×1 (REST only, socket direct) |
| authenticated proxy (creds in URL) | PONG; CONNECT on `:8889` | PONG; CONNECT on `:8889` | not run | Both OK. Header proxy: every CONNECT `proxyAuthOk=true`, `hasOriginAuthorization=false`; origin upgrade `hasProxyAuthorization=false` |
| bogus `127.0.0.1:1` | Hub connects; model call fails after 63s "Cannot connect to API: Unable to connect…" (exit 1) | Hub `connected`; turn fails after 62s, same text | REST fails instantly, same text both | REST fails instantly both (socket never reached) |
| lower-case `https_proxy` | PONG; CONNECT | PONG; CONNECT | not run | Both OK. **Differs** as in the real-proxy row (RC socket proxied) |
| `NO_PROXY` covers API host (+ bogus proxy) | PONG; no proxy lines | not run | not run | Both OK, socket direct (TLS front saw it, no CONNECT) |
| `ALL_PROXY` http (real) | PONG; direct (Bun fetch ignores `ALL_PROXY`) | covered in bogus row | not run | Both OK. **Differs:** RC socket `CONNECT qa-cloud.test:7443`, REST direct; base all direct |
| `ALL_PROXY` bogus / socks5 | PONG (ignored) | covered in bogus row (Hub unaffected) | not run | **RC fails after create (P1-1); base OK** |
| Clash-style (`https_proxy` + `all_proxy=socks5`) | not run | not run | not run | Both OK (RC socket via HTTP proxy) |
| proxy-only network (direct refused) | n/a | n/a | n/a | **RC OK 3/3; base: create OK, then socket "TLS handshake failed" 3/3.** This is the headline improvement |
| proxy dies mid-session, then returns | n/a | n/a | n/a | RC: socket drops, auto-recovers about 3s after restore 4/4 untouched; see P1-2 if touched. Base: unaffected (socket not proxied) |

**Also exercised:**
- Production `wss://api.cline.bot/api/v1/session/<nonexistent>` with the real key on RC and baseline × Bun 1.4.2 / Bun 1.3.13 / Node: RC tunnels `CONNECT api.cline.bot:443` (plain and auth proxy) and gets the same server answer as a direct connection (400). No "Unexpected server response: 101" anywhere (`logs/qa4-probe-prod.log`).
- Header placement on all three runtimes: the proxy sees only `Proxy-Authorization`; the origin sees only `Authorization` (`logs/qa4-header-proxy.log`, `logs/qa4-origin-upgrade-headers.log`).
- Exported desktop diagnostics after the auth-proxy, credentialed-bogus `ALL_PROXY`, and credentialed SOCKS runs, plus all sidecar logs and `~/.cline` state: zero proxy passwords, API keys, or fixture tokens; zero "Unexpected server response"/"Expected 101". The only proxy-related entry is a handled `sdk.error` "Unsupported proxy protocol \"socks5\"".
- Memory: 150 cloud turns through the proxy, sidecar RSS 301→316 MB (RC) vs 301→317 MB (baseline).
- Reconnect timing: the hub client's backoff caps at 5s; a blackhole proxy fails each attempt at the 8s connect timeout.
- The PR's `proxy.test.ts` + `connection-headers.test.ts`: 20/20 pass here.

**Install footprint:**

| Build | Compiled CLI binary | Equal-footing install (`cline` wrapper + SDK + platform package) | Packages |
|---|---|---|---|
| RC | 131,040,736 B | 323,255,500 B | 331 |
| Baseline | 131,036,640 B | 323,229,848 B | 330 |
| Published 3.0.68 | 130,434,528 B (different source commit) | 321,046,903 B | 330 |

- RC adds +4 KB to the binary and +25.6 KB / +1 package to the install over baseline. Published global install: 320,887,770 B, 329 packages.
- In the RC install all three new dependencies resolve from `@cline/core`: `http-proxy-agent@7.0.2` (new), `https-proxy-agent@7.0.6` (now hoisted; `axios` keeps a nested 5.0.1), and `proxy-from-env@2.1.0` (already present). The RC-installed CLI ran a turn through the proxy.

**Not covered (environment):**
- Native Tauri shell.
- A real production cloud session: start, stream, follow-up, close and reopen, web dashboard. Blocked because GitHub isn't connected and I couldn't install the GitHub App. Reopen after app restart against the fixture fails identically on both builds (fixture `taskId` gap), so it is unverified.
- The real `code-cloud-agents` flag and Settings toggle path (dev builds can't load flags).
- Remote/SSH hosts. That path uses token sub-protocol auth with no headers, so by code it never takes the proxy branch; not run.
- A long multi-hour session.
- A packaged desktop baseline v0.0.43; the merge-base v0.0.42 source was used instead.
- No separate known-gaps list was provided. None of these findings appear in the PR's `CLOUD_SESSIONS_FOLLOW_UPS.md`, so nothing is tagged KNOWN.

## 7. Confidence: 7/10

The answer for the CLI and for desktop with cloud off is solidly "unchanged": every CLI and desktop run across three builds, three runtimes, and every proxy variant, with zero proxy traffic to the Hub and identical failures. Desktop cloud with HTTP(S) proxies is strictly improved; I would bet on that part. I'm holding back three points for three reasons:

- The `ALL_PROXY` regression (P1-1) is real and reproducible, though narrow and easy to fix.
- Proxy-outage recovery (P1-2) needs a production check.
- I could not run a single real production cloud session end to end.
