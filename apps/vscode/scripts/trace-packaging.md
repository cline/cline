# Trace activation packaging smoke

Activation remains frozen: these are build-time checks, not approval to publish.
The production intent remains `OTEL_TRACES_EXPORTER=otlp` and
`CLINE_TRACE_RECORD_CONTENT=true`. No sampling override/default is changed.

## Compilation and artifact paths

Compared with upstream main `7e20bbc0e016164574169ab3cfa31701a1237d1e`:

- Stable combined: `ext-vscode-ab-package.yml`, `Build next bundle` in
  `next-src/apps/vscode` runs `bun run package` (production esbuild).
- Nightly combined: the same next compilation path, not the old
  `publish-nightly.mjs` workflow step. The existing manual script remains supported.
- Both combined workflows check `dist/extension.js` after compilation and
  `extension/next/dist/extension.js` extracted from the actual VSIX before upload.
  Loader and legacy payloads are deliberately outside this activation's coverage.
- Standalone stable retains its flags and checks `extension/dist/extension.js`
  inside its VSIX before the marketplace scripts run.
- CLI latest/nightly flags belong on `Build platform binaries`, which invokes
  `apps/cli/script/build.ts`. The expected-platform verification loop checks every
  binary before publishing. `apps/cli/bun.mts` is a separate JS-bundle compilation
  entrypoint and also needs explicit exporter/content defines.
- `build:sdk` preserves literal env reads. Setting activation flags only there
  does not inline them; the consuming application compilation must do that.

Only the combined workflow files were adapted from main; CLI's unrelated signing
and release-notification changes were not imported. Current-main rollout scripts
and client tracing prerequisites (#13974/#14070, including esbuild and CLI binary
defines) must be integrated separately. This older activation checkout alone does
not contain them. A missing feature must fail the smoke, not silently pass.

## Check and limitations

`node scripts/check-trace-artifact.mjs <bundle-or-binary>...` (or `-` for stdin)
requires the trace-specific `tracesExporter: "otlp"` config and the
`cline-provider-langfuse` instrumentation scope string. Generic `otlp` is not
evidence: logs and metrics use it too. Direct exporter/content `process.env`
reads are rejected in dot, bracket and optional access forms. OTel dependency
config keys and resolved build constants legitimately contain the same names;
they are not unresolved environment reads. The smoke does not analyze aliased
environment objects. Sampling env reads are intentionally not rejected.

The smoke tolerates whitespace, quote style and identifier minification used by
current Bun/esbuild. It reads binary-embedded JavaScript without executing it.
Property mangling, escaped literals or compressed bytecode need a different check.
String presence does **not** prove reachable code, correct content decisions,
sampling, opt-out enforcement, tracer ownership, exporter registration or delivery.
The manual single-bundle nightly script checks build output, not extracted VSIX
bytes; standalone stable subsequently repackages in its marketplace scripts.

Run the dependency-free checks from the repository root (avoids the extension's
unrelated SDK-loading preload):

```sh
bun test ./apps/vscode/src/test/trace-packaging.test.ts ./apps/vscode/src/test/publish-nightly.test.ts
```

The minified build test compiles the real SDK telemetry config in two passes and
scans a host-native Bun executable without running it; scope/content fixture
stand-ins do not validate the absent client implementation.
Publication subprocesses in the existing nightly-script tests are mocked. No
workflow dispatch, full runtime harness, credentials, network export or publishing
is required by these tests. Full combined VSIX and all-platform binary checks still
require an integrated checkout and its build dependencies.

## Local validation of the integrated implementation

On September 11, 2026, the check also passed on actual artifacts built from the
client worktree containing #14070 at `368082480` plus the collector-contract
tests: production esbuild `dist/extension.js`, and the host-native darwin-arm64
CLI executable produced by `script/build.ts --single --skip-install
--skip-sdk-build`. Synthetic loopback endpoint/settings were supplied only for
these local builds. The CLI build's `--version` smoke passed; no LLM task or
Langfuse delivery was attempted. The actual extension output exposed legitimate
OTel config keys with the environment-variable name, so the checker deliberately
checks direct environment reads instead of rejecting the name everywhere.

These checks do not constitute a combined A/B VSIX build, cross-platform binary
validation, or staging execution. Those release candidates must still be built
and exercised after integrating current-main rollout prerequisites and the
client fix; activation remains blocked until those checks and staging pass.