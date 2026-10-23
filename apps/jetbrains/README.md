# Cline for JetBrains (Hub edition)

A JetBrains IDE plugin that brings Cline into IntelliJ IDEA, PyCharm, WebStorm,
GoLand, etc. Unlike the VS Code extension, it ships **no agent runtime and no
gRPC bridge**: it talks straight to the local **Cline Hub** daemon over the
hub's native WebSocket JSON protocol (`v1`), the same transport the Cline CLI,
desktop app and hub dashboard use. Sessions started here show up in
`cline session list`, and sessions started from the CLI can be resumed here.

The only prerequisite on the user's machine is the Cline CLI
(`npm install -g cline`), which owns the hub daemon.

## How it works

```
JetBrains IDE ──ws://127.0.0.1:25463/hub──▶ Cline Hub (cline-hub daemon) ──▶ @cline/core agent
   plugin.xml                                    ▲
   HubDiscovery ── reads ~/.cline/data/locks/hub/*.json, GET /health
                └─ falls back to `cline hub ensure --json`
```

1. **Discovery** (`hub/HubDiscovery.kt`). Reads the hub discovery records the
   CLI writes (`production.json` for installed builds, `owners/*.json` for
   source builds; `CLINE_HUB_DISCOVERY_PATH`, `CLINE_DIR`, `CLINE_DATA_DIR`
   are honored), health-probes each one and checks the `hubId` so stale
   records from dead daemons are skipped. If nothing answers it runs
   `cline hub ensure --json --cwd <project>`, which starts a daemon and prints
   its URL and auth token.
2. **Transport** (`hub/HubClient.kt`, `hub/HubProtocol.kt`). A JDK
   `java.net.http.WebSocket` client: authenticates with the
   `cline-hub-auth.<token>` subprotocol, sends `client.register`, subscribes
   to the event stream, correlates `command`/`reply` frames by `requestId`,
   and reconnects with backoff, resuming events from the last `sequence`.
3. **Sessions** (`session/ClineSessionService.kt`, `session/Transcript.kt`).
   `session.create` (provider/model default to what the CLI last used, from
   `~/.cline/data/settings/providers.json`), `session.send_input` for turns,
   `run.abort`, `approval.respond`, `session.list`, `session.messages`.
   `Transcript` is a pure reducer from hub events (`assistant.delta`,
   `reasoning.delta`, `tool.started/updated/finished`, `approval.requested`,
   `run.*`, `usage.updated`, `session.notice`) to renderable items.
4. **UI** (`ui/`). A tool window with connection status, session picker,
   streamed transcript (text, reasoning, tool calls with live output),
   an approval banner, prompt editor with Act/Plan mode, and Send/Stop.
   An editor action (`Ctrl+Shift+L`, also in the editor context menu) drops
   the current selection into the prompt with its path and line range.

## Development

Requirements: JDK 21 (Gradle toolchains will fetch one otherwise).

```bash
cd apps/jetbrains
./gradlew test            # unit tests + live hub test (skips if no hub is running)
./gradlew buildPlugin     # build/distributions/cline-jetbrains-<version>.zip
./gradlew runIde --args="/path/to/some/project"   # sandboxed IDE with the plugin
./gradlew verifyPlugin    # IntelliJ Plugin Verifier against the recommended IDEs
```

The live test (`HubClientLiveTest`) exercises the real protocol against
whichever hub discovery finds; start one with `cline hub start` or, from this
repo, `bun run cli hub start`.

Working from the monorepo without a globally installed `cline`? Point
*Settings | Tools | Cline (Hub) | Cline CLI command* at a wrapper such as
`bash -c 'cd /path/to/cline && bun run --silent cli "$@"' --`, or simply start
the hub yourself with `bun run cli hub start` — discovery will find it.

## Settings

*Settings | Tools | Cline (Hub)*

| Setting | Purpose |
| --- | --- |
| Cline CLI command | Executable (or quoted command line) used for `cline hub ensure --json`. |
| Hub URL override / auth token | Skip discovery and connect to a fixed hub (token stored in the IDE credential store). |
| Discovery record path | Explicit discovery JSON, same as `CLINE_HUB_DISCOVERY_PATH`. |
| Provider / Model | Defaults for new sessions; empty = CLI's last-used provider/model. |
| Default mode | Act (tools enabled) or Plan. |
| Auto-approve tool calls | Sets the session's `toolPolicies["*"].autoApprove`; otherwise approvals surface in the tool window. |

## Layout

```
apps/jetbrains/
├── build.gradle.kts            IntelliJ Platform Gradle Plugin 2.x, Kotlin, JUnit 4
├── src/main/kotlin/bot/cline/jetbrains/
│   ├── hub/        protocol model, frame codec, WebSocket client, discovery
│   ├── session/    project service + transcript reducer
│   ├── settings/   persistent settings + Settings UI
│   ├── ui/         tool window, chat panel, HTML renderer
│   └── actions/    menu/editor actions
├── src/main/resources/META-INF/plugin.xml
└── src/test/kotlin/...         codec, discovery, transcript, renderer, live hub tests
```
