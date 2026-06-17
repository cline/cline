# Bun Migration Notes (apps/vscode)

This document is the canonical reference for the `bun` migration of the
`apps/vscode` package. Read it before "fixing" any `node` reference in docs,
comments, or scripts.

## What changed

**`bun` is now the package manager + task runner for `apps/vscode`.**

- `npm install` / `npm ci` → `bun install`
- `npm run <script>` → `bun run <script>`
- `npx <bin>` → `bunx <bin>`
- `node esbuild.mjs` (build tooling) → `bun esbuild.mjs`
- `ts-node` / `npx tsx <file>.ts` (running a dev TS entrypoint) → `bun <file>.ts`
- `npm-run-all` / `run-p` (parallel tasks) → `bun run --parallel`

## What did NOT change: Node is STILL the runtime

Node remains the **execution runtime** everywhere it mattered before. Bun only
replaced the package manager and the task runner. The following are **Node
runtime / ABI references and MUST NOT be rewritten to bun**:

### KEEP-LIST — do NOT rewrite these `node` tokens

| Reference | Why it stays Node |
|-----------|-------------------|
| esbuild `platform: "node"` / `target: "node..."` | The bundle targets the Node runtime (VSCode extension host, standalone cline-core). |
| `TARGET_NODE_VERSION` (`scripts/package-standalone.mjs`) | Pins the Node ABI of the bundled standalone runtime (matches the JetBrains-packaged Node). |
| `prebuild-install --target=<node version>` | Downloads native `.node` binaries for that Node ABI. |
| `NODE_PATH=... node cline-core.js` | The standalone core is launched by Node, not bun. |
| `node:` import specifiers (e.g. `node:fs`, `node:http`) | Node builtin module scheme; unrelated to tooling. |
| `process.versions.node` | Runtime version probe. |
| `engines.node`, `@types/node` | Declares the Node runtime/types. |
| `ELECTRON_RUN_AS_NODE` | VSCode/Electron runs the extension host as Node. |
| "Extension host debugging (Node.js)" / CDP on the Node inspector | The extension host IS a Node process. |

> ⚠️ **DO NOT rewrite runtime Node references.** When a file legitimately uses
> both, the retained `node` token is the runtime/ABI target, not the build
> tooling that bun now drives. If in doubt, leave it and add a one-line
> clarifying comment rather than changing it.
