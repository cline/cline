# Investigation: Getting Gemini 3 Flash to Use Parallel Tool Calling

## Problem

Cline is 2.6x slower than Cursor on the same task with the same model (Gemini 3 Flash):

| Agent | Execution time | API turns | Tool calls | Tools/turn |
|-------|---------------|-----------|------------|------------|
| Cline | 682s | 23 | 10 | 1.0 |
| Cursor | 264s | unknown | unknown | likely >1 |

On SWE-bench (500 tasks), Cline scores 63.6% vs Cursor 76.4% with the same model. Cline is 4.6x slower on shared passing tasks. The #1 failure mode is timeout/context exhaustion after making edits — Cline runs out of time before finishing.

## Root cause

Parallel tool calling is **enabled** in Cline's configuration. The Gemini 3 prompt says "You may use multiple tools in a single response." But analysis of 1443 API turns across 50 SWE-bench tasks shows Gemini 3 Flash only uses parallel tools on **0.5% of turns**. The model just doesn't do it, even when told it can.

Cursor's leaked prompt aggressively pushes parallel tool use with specific patterns like "batch your tool calls together for optimal performance" and a dedicated `multi_tool_use.parallel` wrapper. Cursor also explicitly says to "start work in the same batch as task-list updates."

## What you should investigate

### 1. How does Cursor get Gemini 3 Flash to call tools in parallel?

Look at the leaked Cursor Agent Prompt 2.0: https://raw.githubusercontent.com/x1xhlol/system-prompts-and-models-of-ai-tools/main/Cursor%20Prompts/Agent%20Prompt%202.0.txt

Key patterns to study:
- How do they phrase the parallel tool calling instruction?
- Do they provide examples of when to batch?
- Do they have a wrapper tool (`multi_tool_use.parallel`)?
- Is it prompt-only, or is there likely an orchestration-level mechanism?

### 2. What changes could we make to Cline's Gemini 3 prompt to encourage parallel calling?

The relevant files:
- `src/core/prompts/system-prompt/variants/gemini-3/overrides.ts` — Gemini 3 prompt overrides (TOOL_USE, OBJECTIVE, RULES sections)
- `src/core/prompts/system-prompt/components/rules.ts` — shared rules (Gemini 3 overrides this, but check for leakage)
- `src/core/api/providers/gemini.ts` — API config, currently uses `FunctionCallingConfigMode.ANY`

Specific questions:
- Would stronger language like "You SHOULD batch independent reads and searches" help?
- Should we add concrete examples? ("When you need to read 3 files, call read_file 3 times in the same response")
- Would a `multi_tool_use` wrapper tool help, like Cursor has?
- Does `FunctionCallingConfigMode.ANY` vs `AUTO` affect parallel behavior?

### 3. Is there an API-level or orchestration-level change needed?

Check:
- `src/core/api/providers/gemini.ts` line ~194: `functionCallingConfig: { mode: FunctionCallingConfigMode.ANY }` — does ANY mode discourage multiple calls? Would AUTO be better?
- `src/core/task/index.ts` — the stream interrupt logic at `!this.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool` — confirm this is NOT firing for Gemini 3
- Does the Gemini API actually return multiple `functionCall` parts in a single response when the model wants to? Or is there an API-level limit?

### 4. Propose a concrete change

Write a spec for the minimal change that would make Gemini 3 Flash use parallel tool calls more often. Consider:
- Prompt-only changes (lowest risk)
- API config changes (`ANY` → `AUTO`)
- Adding a `multi_tool_use.parallel` meta-tool
- Orchestration changes (auto-batching independent operations)

Rank by expected impact and implementation risk.

## Evidence to reference

- Cline's SWE-bench logs: `/Users/robin/dev/harbor/local-results/2026-03-05__09-37-39/` (500 tasks)
- Cursor's SWE-bench logs: `/Users/robin/dev/harbor/local-results/2026-03-05__19-30-16/` (500 tasks)
- Local benchmark logs:
  - Cline: `/Users/robin/dev/harbor/jobs/2026-03-05__15-41-14/django__django-13590__hsPtcx7/agent/cline.txt`
  - Cursor: `/Users/robin/dev/harbor/jobs/2026-03-05__15-40-45/django__django-13590__5xdKmYk/agent/cursor-cli.txt`

## Success criteria

A change that, on the `django__django-13590` local benchmark task, reduces Cline's execution time from ~682s toward Cursor's ~264s while maintaining a passing result (reward: 1.0).
