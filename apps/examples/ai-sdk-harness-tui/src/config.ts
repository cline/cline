import type { ClineAuthenticationMode } from "@ai-sdk/harness-cline";
import type {
	ResponseStatisticsMode,
	TerminalPartDisplayMode,
} from "@ai-sdk/tui";

const authenticationModes = ["auto", "direct", "ai-gateway"] as const;
const reasoningEfforts = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
type ReasoningEffort = (typeof reasoningEfforts)[number];
const displayModes = ["full", "collapsed", "auto-collapsed", "hidden"] as const;
const statisticsModes = ["outputTokenCount", "outputTokensPerSecond"] as const;

function optionalInteger(name: string): number | undefined {
	const value = process.env[name];
	if (!value) return undefined;

	const parsed = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function enumValue<const T extends readonly string[]>(
	name: string,
	values: T,
	fallback: T[number],
): T[number] {
	const value = process.env[name];
	if (!value) return fallback;
	if (!values.includes(value)) {
		throw new Error(`${name} must be one of: ${values.join(", ")}`);
	}
	return value as T[number];
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
	return {
		harness: {
			auth: enumValue(
				"CLINE_HARNESS_AUTH",
				authenticationModes,
				"auto",
			) as ClineAuthenticationMode,
			providerId: process.env.CLINE_PROVIDER_ID,
			modelId: process.env.CLINE_MODEL_ID,
			apiKey: process.env.CLINE_API_KEY,
			baseUrl: process.env.CLINE_API_BASE_URL,
			reasoningEffort: enumValue(
				"CLINE_REASONING_EFFORT",
				reasoningEfforts,
				"medium",
			) as ReasoningEffort,
			maxIterations: optionalInteger("CLINE_MAX_ITERATIONS"),
		},
		agent: {
			id: process.env.CLINE_AGENT_ID ?? "cline-harness-tui",
			permissionMode: enumValue(
				"CLINE_PERMISSION_MODE",
				["allow-reads", "allow-edits", "allow-all"] as const,
				"allow-reads",
			),
			debug: process.env.HARNESS_DEBUG === "1",
		},
		tui: {
			title: process.env.CLINE_TUI_TITLE ?? "Cline AI SDK Harness",
			tools: enumValue(
				"CLINE_TUI_TOOLS",
				displayModes,
				"auto-collapsed",
			) as TerminalPartDisplayMode,
			reasoning: enumValue(
				"CLINE_TUI_REASONING",
				displayModes,
				"collapsed",
			) as TerminalPartDisplayMode,
			responseStatistics: enumValue(
				"CLINE_TUI_STATISTICS",
				statisticsModes,
				"outputTokensPerSecond",
			) as ResponseStatisticsMode,
			contextSize: optionalInteger("CLINE_CONTEXT_SIZE"),
		},
	};
}
