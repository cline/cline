# Bun (tooling) and Node (runtime)

This repo uses **bun** for package management and task running, and **Node** as
the execution runtime. Both are correct at the same time; the distinction is the
source of most confusion, so keep it straight before editing scripts, configs,
docs, or comments.

## Use bun for tooling

- `bun install` (never `npm install` / `npm ci`)
- `bun run <script>` (never `npm run <script>`)
- `bunx <bin>` (never `npx <bin>`)
- `bun <file>.ts` to run a TS entrypoint directly (no `ts-node` / `tsx`)
- `bun esbuild.mjs` to drive the build (esbuild/vite are still the bundlers)
- `bun run --parallel ...` for parallel tasks

The root `bun.lock` is the single lockfile for the whole workspace, including
`apps/vscode`, `webview-ui`, and `testing-platform`. There are no per-package npm
lockfiles.

## Node is the runtime — do NOT rewrite these to bun

The build product runs on Node: the VS Code extension host loads
`dist/extension.js` as CommonJS under Node, and the standalone `cline-core` is a
Node process. The following are Node runtime/ABI references and are correct as-is:

| Reference | Why it is Node |
|-----------|----------------|
| esbuild `platform: "node"` / `target: "node..."` | The bundle targets the Node runtime (extension host, standalone core). |
| `TARGET_NODE_VERSION` (`scripts/package-standalone.mjs`) | Pins the Node ABI of the bundled standalone runtime (matches the JetBrains-packaged Node). |
| `prebuild-install --target=<node version>` | Downloads native `.node` binaries for that Node ABI. |
| `NODE_PATH=... node cline-core.js` | The standalone core is launched by Node, not bun. |
| `node:` import specifiers (e.g. `node:fs`) | Node builtin module scheme; unrelated to tooling. |
| `process.versions.node`, `engines.node`, `@types/node` | Runtime version probe / declared runtime / its types. |
| `ELECTRON_RUN_AS_NODE` | VS Code/Electron runs the extension host as Node. |

When a file legitimately uses both bun and node (e.g. `package-standalone.mjs`
does `bun install` but `prebuild-install --target=<node>`), the `node` token is
the runtime/ABI target, not tooling. If unsure, leave it.

## Tests: bun vs the VS Code host

A test file's runner is decided by its import:

- **`import ... from "bun:test"`** → runs under `bun test` (the node-side unit
  suites + the SDK/model-catalog suites). `scripts/run-bun-unit-tests.ts`
  discovers these by the `bun:test` import and runs one isolated bun process per
  file. `build-tests.js` excludes them from the integration compile so the
  `bun:test` builtin never reaches Node.
- **`import ... from "mocha"`** → runs under `@vscode/test-cli` in a real VS Code
  extension host (Node). These exercise the live `vscode` API and cannot run
  under bun.

So a file imports `bun:test` XOR `mocha`. Don't add `bun:test` to a test that
needs the real extension host.
