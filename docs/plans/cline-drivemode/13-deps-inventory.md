# 13 · Dependency inventory (U0)

Back to [README](README.md). Parent plan: upgrade + primitives audit.

**Scope.** Main workspace packages only (excludes `.claude/worktrees/**`).  
**Captured.** Execution inventory for Drive / hub / SDK path.  
**Latest column.** `npm view <pkg> version` at inventory time (may drift).

## Toolchain

| Dep | Current (pinned/range) | Latest on npm | Notes |
|---|---|---|---|
| Bun | 1.3.x (AGENTS: 1.3.13) | track bun.sh | Keep Node >=22 |
| TypeScript | 5.9.3 (hub/ui); 5.4.5 (vscode) | **7.0.2** | Major; stay on 5.9 until TS7 migration planned |
| @biomejs/biome | **2.5.5** root; **^2.5.5** vscode | 2.5.5 | **U1 done** — aligned |
| Vitest | **^4.1.10** most + vscode webview-ui | 4.1.10 | **U1 done** — vscode webview-ui off Vitest 3 |

## UI / bundler

| Dep | Current | Latest | Notes |
|---|---|---|---|
| React / react-dom | **19.2.4** hub/cli/ui/desktop; **^18.3.1** vscode webview-ui | 19.2.8 | Align vscode webview-ui to 19 when extension host allows |
| Vite | **^8.0.0** hub + sdk/ui; **^7.1.11** vscode webview-ui | 8.1.5 | **U2 partial** — hub/sdk-ui on 8; vscode webview stays on 7 until rolldown OutputOptions migrate |
| Tailwind | ^4.2.x hub/ui; ^4.1.x vscode | 4.3.3 | Minor bump OK after visual smoke |
| lucide-react | ^0.577 hub; ^0.511 vscode webview; ^0.564 desktop | **1.27.0** | Major icon package; audit renames (Headphones etc.) |
| mermaid | **11.16.0** hub + vscode webview | 11.16.0 | Already current |

## Schema / AI stack

| Dep | Current | Latest | Notes |
|---|---|---|---|
| zod | **^4.3.6** sdk/cli/desktop/agents-squad | 4.4.3 | **U3 done** — desktop off Zod 3; minors aligned to 4.3.6 |
| ai | ^6.0.144 llms; ^6.0.116 hub webview | **7.0.40** | Major — coordinate with @ai-sdk/* |
| @ai-sdk/anthropic | ^3.0.68 | **4.0.23** | Major with `ai@7` |
| @ai-sdk/openai | ^3.0.52 | **4.0.22** | Major with `ai@7` |
| @ai-sdk/provider | ^3.0.8 | check with ai@7 | Keep peer-aligned |
| @ai-sdk/amazon-bedrock | ^4.0.89 | check | Already on 4.x line |
| @modelcontextprotocol/sdk | ^1.29.0 core; ^1.25.1 vscode | check | Prefer single range |

## Drift / inconsistency (fix in U2–U5)

1. **React 18 vs 19** across vscode webview-ui vs hub/cli/ui.  
2. ~~**Vite 7 vs 8**~~ **U2 fixed** (Vite 8 on vscode webview-ui + sdk/ui). React 18 remains on vscode webview-ui.  
3. ~~**Vitest 3 vs 4** in vscode webview-ui.~~ **U1 fixed**  
4. ~~**Zod 3 vs 4** in desktop-app example.~~ **U3 fixed**  
5. ~~**lucide-react** three different 0.x minors + looming 1.x.~~ **U5 hub/desktop/examples → ^1.27.0**; vscode webview-ui still on 0.511  
6. **ai** package slightly different minors between hub webview and llms.

## Recommended upgrade order (unchanged from plan)

~~U1 toolchain (Biome, Vitest align)~~ **done** → U2 hub Vite already 8; vscode Vite/React later → U3 Zod align desktop → U4 AI SDK major as dedicated PR → U5 lucide 1.x with icon audit → U6 mermaid stay / patch.

## License gate

SDK path Apache-2.0 only. Review each major bump’s license file before merge.

## Workspace package count (main tree)

~35 `package.json` files under apps/, sdk/, docs/, evals/ (excluding worktrees). Full machine dump can be regenerated with the inventory script in the parent plan.
