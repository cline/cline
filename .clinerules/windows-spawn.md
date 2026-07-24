# Spawning `.cmd` wrappers on Windows

npm-generated launchers (`npx`, `npm`, `cline`, any package bin) are `.cmd`
shims on Windows. `spawn` can't run a `.cmd` without `shell: true`, but a shell
re-parses the command line, so metacharacters in an argument (`& | < > %VAR%`)
get reinterpreted — e.g. an npm semver range like `mongodb-mcp-server@<3` is
mangled. Escaping through `cmd.exe` can't be done reliably; don't try.

- **Constant args you control** → `shell: true` is fine.
- **Caller/config/catalog-supplied args** → never `shell: true`. Resolve a
  shell-free invocation instead:

```typescript
import { resolveShellFreeInvocation } from "@cline/shared/node"

const inv = resolveShellFreeInvocation(command, args) // runs node on the shim's script
const child = spawn(inv?.command ?? command, inv?.args ?? args, {
	shell: process.platform === "win32" && !inv, // only for a genuine non-npm .cmd
	windowsHide: true,
})
```

See `sdk/packages/shared/src/spawn.ts` for the resolvers and the details.

