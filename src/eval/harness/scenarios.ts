/**
 * Offline scenario battery: representative weak-model failure modes run through the real
 * harness code. Deterministic and free — no model API calls. Add new failure modes here as
 * they are observed in the wild (telemetry: tool_input_repaired / loop_detected / etc.).
 */

import type { ApiProviderInfo } from "@/core/api"
import { formatResponse } from "@/core/prompts/responses"
import { checkRepeatedToolCall, checkSemanticLoop, toolCallSignature } from "@/core/task/loop-detection"
import { TaskState } from "@/core/task/TaskState"
import { repairMcpArgumentsString, repairToolParams } from "@/core/task/tools/ToolInputRepair"
import { getModelCapabilityTier, recommendedMaxMistakes, supportsAutoCondense } from "@/utils/model-capabilities"
import type { EvalScenario } from "./scorecard"

const ok = (passed: boolean, detail?: string) => ({ passed, detail })
const tier = (id: string) => getModelCapabilityTier({ model: { id } } as ApiProviderInfo)
const parses = (raw: string): Record<string, unknown> | undefined => {
	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}

export const offlineScenarios: EvalScenario[] = [
	// --- tool-input-repair (Domain A: path-like params) ---
	{
		id: "autolink-path-with-scheme",
		category: "tool-input-repair",
		description: "read_file path wrapped as a markdown autolink with a fake scheme is unwrapped",
		run: () => {
			const { params, repairs } = repairToolParams({ path: "[src/foo.ts](http://src/foo.ts)" })
			return ok(params.path === "src/foo.ts" && repairs.length === 1, `got ${params.path}`)
		},
	},
	{
		id: "autolink-path-no-scheme",
		category: "tool-input-repair",
		description: "schemeless markdown autolink path is unwrapped",
		run: () => {
			const { params } = repairToolParams({ path: "[notes.md](notes.md)" })
			return ok(params.path === "notes.md", `got ${params.path}`)
		},
	},
	{
		id: "plain-path-untouched",
		category: "tool-input-repair",
		description: "a clean path is never modified (idempotence)",
		run: () => {
			const { params, repairs } = repairToolParams({ path: "src/bar.ts" })
			return ok(params.path === "src/bar.ts" && repairs.length === 0)
		},
	},
	{
		id: "code-bearing-content-untouched",
		category: "tool-input-repair",
		description: "write_to_file content containing markdown links is left alone",
		run: () => {
			const content = "See [the docs](http://x) and ```json fenced``` block"
			const { params, repairs } = repairToolParams({ path: "a.md", content })
			return ok(params.content === content && repairs.length === 0)
		},
	},

	// --- mcp-json-repair (Domain B: MCP arguments string) ---
	{
		id: "mcp-fenced-json",
		category: "mcp-json-repair",
		description: "MCP arguments wrapped in a ```json fence are stripped and parse",
		run: () => {
			const { value } = repairMcpArgumentsString('```json\n{"gauge":"01010000"}\n```')
			return ok(parses(value)?.gauge === "01010000", value)
		},
	},
	{
		id: "mcp-trailing-comma",
		category: "mcp-json-repair",
		description: "trailing comma in MCP arguments is fixed and parses",
		run: () => {
			const { value } = repairMcpArgumentsString('{"a":1,}')
			return ok(parses(value)?.a === 1, value)
		},
	},
	{
		id: "mcp-single-arg-unwrap",
		category: "mcp-json-repair",
		description: "a wrapper key ({input:{...}}) is unwrapped to the inner object",
		run: () => {
			const { value } = repairMcpArgumentsString('{"input":{"x":1}}')
			const parsed = parses(value)
			return ok(parsed?.x === 1 && !("input" in (parsed ?? {})), value)
		},
	},
	{
		id: "mcp-valid-untouched",
		category: "mcp-json-repair",
		description: "already-valid single-key JSON is returned unchanged",
		run: () => {
			const raw = '{"a":1}'
			const { value, repairs } = repairMcpArgumentsString(raw)
			return ok(value === raw && repairs.length === 0 && parses(value)?.a === 1, value)
		},
	},

	// --- loop-detection ---
	{
		id: "semantic-zero-result-search-trips",
		category: "loop-detection",
		description: "repeated zero-result searches on the same path trip the semantic soft warning",
		run: () => {
			const state = new TaskState()
			state.consecutiveZeroResultSearches = 3
			return ok(checkSemanticLoop(state, "search_files", { regex: "x" }).softWarning)
		},
	},
	{
		id: "semantic-distinct-reads-ok",
		category: "loop-detection",
		description: "reading distinct paths never trips the semantic detector",
		run: () => {
			const state = new TaskState()
			const a = checkSemanticLoop(state, "read_file", { path: "a.ts" }).softWarning
			const b = checkSemanticLoop(state, "read_file", { path: "b.ts" }).softWarning
			const c = checkSemanticLoop(state, "read_file", { path: "c.ts" }).softWarning
			return ok(!a && !b && !c)
		},
	},
	{
		id: "byte-identical-loop-trips",
		category: "loop-detection",
		description: "three identical tool calls in a row trip the byte-identical soft warning",
		run: () => {
			const state = new TaskState()
			const sig = toolCallSignature({ path: "x.ts" })
			// Mirror the real loop: ToolExecutor updates lastToolName/lastToolParams after each check.
			let result = checkRepeatedToolCall(state, "read_file", sig)
			for (let i = 0; i < 2; i++) {
				state.lastToolName = "read_file"
				state.lastToolParams = sig
				result = checkRepeatedToolCall(state, "read_file", sig)
			}
			return ok(result.softWarning)
		},
	},

	// --- capability-routing ---
	{
		id: "deepseek-v4-capable-open",
		category: "capability-routing",
		description: "DeepSeek-v4-pro is capable-open: auto-condense on, mistake budget 5",
		run: () => {
			const t = tier("deepseek-v4-pro")
			return ok(t === "capable-open" && supportsAutoCondense(t) && recommendedMaxMistakes(t) === 5, t)
		},
	},
	{
		id: "claude-frontier",
		category: "capability-routing",
		description: "Claude-4 is frontier: auto-condense on, stricter mistake budget 3",
		run: () => {
			const t = tier("claude-sonnet-4-5")
			return ok(t === "frontier" && supportsAutoCondense(t) && recommendedMaxMistakes(t) === 3, t)
		},
	},
	{
		id: "unknown-basic",
		category: "capability-routing",
		description: "an unknown small model is basic: no auto-condense",
		run: () => {
			const t = tier("some-random-7b")
			return ok(t === "basic" && !supportsAutoCondense(t))
		},
	},

	// --- resilience-nudge ---
	{
		id: "nudge-grounds-in-errors",
		category: "resilience-nudge",
		description: "the decompose nudge cites the concrete recent failures it is given",
		run: () => {
			const out = formatResponse.decomposeTaskNudge(["[search_files] Found 0 results.", "[read_file] ENOENT"])
			return ok(out.includes("Found 0 results.") && out.includes("ENOENT"))
		},
	},
	{
		id: "nudge-generic-without-errors",
		category: "resilience-nudge",
		description: "the decompose nudge degrades gracefully when no errors are captured",
		run: () => {
			const out = formatResponse.decomposeTaskNudge()
			return ok(out.includes("unsuccessful attempts") && !out.includes("most recent tool failures"))
		},
	},
]
