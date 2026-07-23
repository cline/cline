# Spawning `.cmd` wrappers on Windows

On Windows the npm-generated launchers (`npx`, `npm`, `cline`, and any
package's bin) are **`.cmd` batch shims**, not executables. `child_process.spawn`
cannot run a `.cmd` directly — it must go through `cmd.exe` — so a plain
`spawn("npx", args)` fails on Windows unless you set `shell: true`.

But `shell: true` is a trap when any argument is not a fixed constant. With a
`.cmd` target the command line is parsed **twice**: first by `cmd.exe` (which
interprets `& | < > ( ) ^ " %VAR% !`), then again by the program the shim
launches (Node, under the MSVCRT argv rules). An argument containing a shell
metacharacter is reinterpreted before the program ever sees it. This is not
hypothetical: npm semver ranges shipped in the marketplace catalog
(`mongodb-mcp-server@<3`, `@toolbox-sdk/server@>=1.1.0`) have `<`/`>` that
`cmd.exe` treats as redirection, so the install is mangled. `%VAR%`/`!VAR!` are
worse — they have **no** command-line-level escape (this is CVE-2024-27980, why
Node *requires* `shell: true` for `.cmd` targets and documents their args as
unsafe).

## The rule

- **Fixed, constant arguments → `shell: true` is acceptable.** If every argument
  is a literal you control (`npm install -g kanban@latest`, `kanban --version`),
  running the `.cmd` through the shell is fine.
- **Arbitrary / caller- or catalog-supplied arguments → never `shell: true`.**
  Do not try to escape them; escaping through `cmd.exe` cannot be done correctly
  in general. Instead invoke **`node.exe` directly on the script the shim wraps**
  so each argument is a distinct argv item and no shell parses it.

## How

Use the resolvers in `@cline/shared/node`:

```typescript
import { resolveShellFreeInvocation } from "@cline/shared/node"

const invocation = resolveShellFreeInvocation(command, args)
// win32: { command: "…\\node.exe", args: ["…\\npx-cli.js", ...args] } — no shell
// other: { command, args } unchanged
// undefined: only a non-npm `.cmd` exists → fall back to shell:true, or error
const child = spawn(
	invocation?.command ?? command,
	invocation?.args ?? args,
	{ shell: process.platform === "win32" && !invocation, windowsHide: true },
)
```

`resolveShellFreeInvocation` special-cases `npx` (npm's `npx-cli.js` under
`node.exe`), resolves a native `.exe` when one exists, and otherwise parses the
`.cmd` shim to recover the `node <script>` it runs — reconstructing the shim's
own `%~dp0`-relative lookup (needed because a global `cline.cmd` sits in the npm
prefix, not next to `node.exe`). It returns `undefined` only for a genuine
non-npm `.cmd`, the one case that truly requires a shell.

For a plain executable target (not a `.cmd`) with `shell: false`, libuv already
quotes the args array correctly; just don't turn the shell on.
