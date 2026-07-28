# 13 · Dependency inventory (U0)

Back to [README](README.md). Parent plan: upgrade + primitives audit.  
**PR 24 handoff:** [HANDOFF-pr24-u4.md](HANDOFF-pr24-u4.md).

**Scope.** Main workspace packages only (excludes `.claude/worktrees/**`).  
**Captured.** Execution inventory for Drive / hub / SDK path.  
**Latest column.** `npm view <pkg> version` at inventory time (may drift).

## Toolchain

| Dep | Current (pinned/range) | Latest on npm | Notes |
|---|---|---|---|
| Bun | 1.3.x (AGENTS: 1.3.13) | track bun.sh | Keep Node >=22 |
| TypeScript | 5.9.3 (hub/ui); 5.4.5 (vscode) | **7.0.2** | Major; stay on 5.9 until TS7 migration planned |
| @biomejs/biome | **2.5.5** root; **^2.5.5** vscode | 2.5.5 | **U1 done** — aligned |
| Vitest | **^4.1.10** most; **^3.0.5** vscode webview-ui | 4.1.10 | Root/sdk on 4.x; **vscode webview-ui stays on Vitest 3** |

## UI / bundler

| Dep | Current | Latest | Notes |
|---|---|---|---|
| React / react-dom | **19.2.4** hub/cli/ui/desktop; **^18.3.1** vscode webview-ui | 19.2.8 | Align vscode webview-ui to 19 when extension host allows |
| Vite | **^8.0.0** hub + sdk/ui; **^7.1.11** vscode webview-ui | 8.1.5 | **U2 partial** — vscode stays on 7 until rolldown OutputOptions migrate |
| Tailwind | ^4.2.x hub/ui; ^4.1.x vscode | 4.3.3 | Minor bump OK after visual smoke |
| lucide-react | **^1.27.0** hub/desktop/examples; **^0.511** vscode webview | 1.27.0 | **U5 partial** — vscode needs icon audit |
| mermaid | **11.16.0** hub + vscode webview | 11.16.0 | Already current |

## Schema / AI stack

| Dep | Current | Latest | Notes |
|---|---|---|---|
| zod | **^4.3.6** sdk/cli/desktop/agents-squad | 4.4.3 | **U3 done** |
| ai | **^7.0.40** llms/hub (PR 24) | 7.0.40 | **U4 in progress** — see HANDOFF-pr24-u4 |
| ai-sdk-ollama | **^4.1.0** (PR 24) | 4.1.0 | ai@7 peer; LanguageModelV4 |
| ai-sdk-provider-opencode-sdk | ^3.0.1 | 3.0.6 | Still `@ai-sdk/provider@^3` — no ai@7 release |
| dify-ai-provider | ^1.1.0 | 1.1.1 | Still `@ai-sdk/provider@^2` — no ai@7 release |
| @jerome-benoit/sap-ai-provider | 4.8.0 | 4.8.0 | peer `ai@^5\|\|^6` only — no ai@7 release |
| @ai-sdk/anthropic | **^4.0.23** | 4.0.23 | Aligned with ai@7 |
| @ai-sdk/openai | **^4.0.22** | 4.0.22 | Aligned with ai@7 |
| @ai-sdk/provider | **^4.0.4** | 4.0.4 | Aligned with ai@7 |
| @ai-sdk/amazon-bedrock | **^5.0.34** (PR 24) | check | Bumped with ai@7 |
| @ai-sdk/google-vertex | **^5.0.33** (PR 24) | check | Bumped with ai@7 |
| @modelcontextprotocol/sdk | ^1.29.0 core; ^1.25.1 vscode | check | Prefer single range |

## Drift / remaining (after PR 23)

1. **React 18 vs 19** — vscode webview-ui still on 18.  
2. **Vite 7 vs 8** — vscode webview-ui still on 7.  
3. **Vitest 3 vs 4** — vscode webview-ui intentionally on 3.  
4. **lucide-react** — vscode webview-ui still on 0.511.  
5. **U4 in progress** — U4-A done; U4-B peers/deprecations (see HANDOFF-pr24-u4).

## Recommended upgrade order

~~U0–U1, U3~~ **done on main (PR 23)** · ~~U5 hub lucide~~ **done** · **U4** = PR 24 · then U2b/U2c/U5b (vscode Vite/React/lucide) · U6 transitive · TS 7 later.

## License gate

SDK path Apache-2.0 only. Review each major bump’s license file before merge.

## Workspace package count (main tree)

~35 `package.json` files under apps/, sdk/, docs/, evals/ (excluding worktrees).
