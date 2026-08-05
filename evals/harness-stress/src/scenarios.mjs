const DEFAULT_BURST_BYTES = 4 * 1024 * 1024;
const DEFAULT_FRAGMENT_DELAY_MS = 5;
const DEFAULT_SLOW_CHUNK_DELAY_MS = 1_000;
const DEFAULT_REPEATED_TOOL_CALLS = 20;

export const SCENARIOS = Object.freeze({
	baseline: {
		description: "One normally streamed safe command callback",
		kind: "tool",
	},
	"fragmented-tool-call": {
		description:
			"A safe tool call whose JSON arguments arrive one character at a time",
		kind: "tool",
		fragmentArguments: true,
	},
	"slow-chunks": {
		description: "A safe tool call with a long delay between every SSE chunk",
		kind: "tool",
		slowChunks: true,
	},
	"stall-after-tool-start": {
		description: "Starts a tool call and then leaves the SSE connection open",
		kind: "stall",
	},
	"disconnect-after-tool-start": {
		description: "Starts a tool call and then abruptly closes the socket",
		kind: "disconnect",
	},
	"burst-output": {
		description: "Streams a large text response in a tight burst",
		kind: "burst",
	},
	"repeated-safe-tools": {
		description: "Runs the safe callback tool repeatedly across model turns",
		kind: "tool",
		repeated: true,
	},
});

export function scenarioNames() {
	return Object.keys(SCENARIOS);
}

export function resolveScenario(model) {
	const value = typeof model === "string" ? model : "";
	const candidate = value
		.replace(/^cline-harness\//, "")
		.replace(/^harness\//, "");
	return Object.hasOwn(SCENARIOS, candidate) ? candidate : "baseline";
}

export function scenarioLimits(env = process.env) {
	return {
		burstBytes: boundedInteger(
			env.CLINE_HARNESS_BURST_BYTES,
			DEFAULT_BURST_BYTES,
			1,
			64 * 1024 * 1024,
		),
		fragmentDelayMs: boundedInteger(
			env.CLINE_HARNESS_FRAGMENT_DELAY_MS,
			DEFAULT_FRAGMENT_DELAY_MS,
			0,
			10_000,
		),
		slowChunkDelayMs: boundedInteger(
			env.CLINE_HARNESS_SLOW_CHUNK_DELAY_MS,
			DEFAULT_SLOW_CHUNK_DELAY_MS,
			0,
			60_000,
		),
		repeatedToolCalls: boundedInteger(
			env.CLINE_HARNESS_REPEATED_TOOL_CALLS,
			DEFAULT_REPEATED_TOOL_CALLS,
			1,
			1_000,
		),
	};
}

function boundedInteger(raw, fallback, minimum, maximum) {
	if (raw === undefined || raw === "") return fallback;
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(
			`Expected an integer from ${minimum} to ${maximum}, received ${JSON.stringify(raw)}`,
		);
	}
	return parsed;
}
