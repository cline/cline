/**
 * Every cap governing how much text moves between the model and its tools.
 *
 * Two layers are represented here, and they interact. Executors cap what they
 * return (`command`/`read`/`search` output); the provider-request builder caps
 * what it forwards (`toolResult` and friends). A builder cap at or below an
 * executor cap re-cuts output the executor already sized, eliding the recovery
 * notice it placed in the tail, so `resolveContextLimits` keeps the two apart.
 *
 * Every value is in characters (UTF-16 code units) except `totalTextBytes`,
 * which is bytes, and the two line counts.
 */

/** Provider-request budgets, applied while assembling messages for the API. */
export interface MessageContextLimits {
	toolResultChars: number;
	fileContentChars: number;
	totalTextBytes: number;
	assistantTextChars: number;
	assistantToolMarkupChars: number;
	minOutdatedRewriteBytes: number;
}

/** Executor and tool-input budgets, applied before a result is ever returned. */
export interface ToolContextLimits {
	commandOutputChars: number;
	readLines: number;
	lineChars: number;
	readOutputChars: number;
	searchOutputChars: number;
	webFetchContentChars: number;
	editorInputChars: number;
	commandInputChars: number;
	editorDiffLines: number;
	commandPreviewChars: number;
}

export interface ContextLimits {
	message: MessageContextLimits;
	tool: ToolContextLimits;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
	message: {
		toolResultChars: 50_000,
		fileContentChars: 50_000,
		// Budget truncation rewrites bytes mid-transcript, which invalidates
		// provider prefix caches from the first rewritten block onward, so this
		// stays far above the per-result cap: a rare overflow valve.
		totalTextBytes: 6_000_000,
		assistantTextChars: 200_000,
		assistantToolMarkupChars: 12_000,
		// Batch stale-read rewrites to spare prefix caches; 0 rewrites eagerly.
		minOutdatedRewriteBytes: 65_536,
	},
	tool: {
		commandOutputChars: 48_000,
		readLines: 2_000,
		// Keeps a minified bundle's single 3MB line from swallowing the window.
		lineChars: 2_000,
		readOutputChars: 48_000,
		searchOutputChars: 48_000,
		webFetchContentChars: 48_000,
		editorInputChars: 50_000,
		commandInputChars: 12_000,
		editorDiffLines: 200,
		commandPreviewChars: 200,
	},
};

/**
 * Executors append a truncation notice past their own budget, so a capped
 * result arrives slightly over it. The forwarding cap has to clear that.
 */
const EXECUTOR_TRUNCATION_NOTICE_HEADROOM_CHARS = 2_000;

export const MESSAGE_LIMIT_ENV: Record<keyof MessageContextLimits, string> = {
	toolResultChars: "CLINE_MESSAGE_BUILDER_MAX_TOOL_RESULT_CHARS",
	fileContentChars: "CLINE_MESSAGE_BUILDER_MAX_FILE_CONTENT_CHARS",
	totalTextBytes: "CLINE_MESSAGE_BUILDER_MAX_TOTAL_TEXT_BYTES",
	assistantTextChars: "CLINE_MESSAGE_BUILDER_MAX_ASSISTANT_TEXT_CHARS",
	assistantToolMarkupChars:
		"CLINE_MESSAGE_BUILDER_MAX_ASSISTANT_TOOL_MARKUP_CHARS",
	minOutdatedRewriteBytes: "CLINE_MESSAGE_BUILDER_MIN_OUTDATED_REWRITE_BYTES",
};

export const TOOL_LIMIT_ENV: Record<keyof ToolContextLimits, string> = {
	commandOutputChars: "CLINE_TOOL_MAX_COMMAND_OUTPUT_CHARS",
	readLines: "CLINE_TOOL_MAX_READ_LINES",
	lineChars: "CLINE_TOOL_MAX_LINE_CHARS",
	readOutputChars: "CLINE_TOOL_MAX_READ_OUTPUT_CHARS",
	searchOutputChars: "CLINE_TOOL_MAX_SEARCH_OUTPUT_CHARS",
	webFetchContentChars: "CLINE_TOOL_MAX_WEB_FETCH_CONTENT_CHARS",
	editorInputChars: "CLINE_TOOL_MAX_EDITOR_INPUT_CHARS",
	commandInputChars: "CLINE_TOOL_MAX_COMMAND_INPUT_CHARS",
	editorDiffLines: "CLINE_TOOL_MAX_EDITOR_DIFF_LINES",
	commandPreviewChars: "CLINE_TOOL_MAX_COMMAND_PREVIEW_CHARS",
};

/** Parses a positive integer; anything else leaves the default in place. */
function parsePositiveEnv(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return undefined;
	const value = Number.parseInt(trimmed, 10);
	return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * `minOutdatedRewriteBytes` alone accepts 0 to rewrite eagerly, and
 * "infinity"/"disable" to switch stale-read rewriting off entirely.
 */
function parseNonNegativeEnv(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	const normalized = trimmed.toLowerCase();
	if (normalized === "infinity" || normalized === "disable") {
		return Number.POSITIVE_INFINITY;
	}
	if (trimmed === "0") return 0;
	return parsePositiveEnv(trimmed);
}

export interface ContextLimitOverrides {
	message?: Partial<MessageContextLimits>;
	tool?: Partial<ToolContextLimits>;
}

/** Caps on output an executor sizes itself, which the forwarding cap must clear. */
const BUDGETED_OUTPUT_KEYS = [
	"commandOutputChars",
	"readOutputChars",
	"searchOutputChars",
	"webFetchContentChars",
] as const;

/**
 * Floor for a budgeted cap. Below roughly this, an executor's own truncation
 * notice would be most of what it returns.
 */
const MIN_BUDGETED_OUTPUT_CHARS = 1_000;

/**
 * Resolves limits from env over explicit overrides over defaults, then restores
 * the invariant the two layers share: `toolResultChars` must exceed every
 * budgeted executor cap by the notice headroom, or forwarding re-cuts output an
 * executor already sized and elides the notice from its middle.
 *
 * Lowering `toolResultChars` is a supported way to spend fewer tokens, so caps
 * the caller did not set follow it down (never below
 * {@link MIN_BUDGETED_OUTPUT_CHARS}). A cap the caller did set is never
 * discarded — `toolResultChars` rises to clear it instead.
 */
export function resolveContextLimits(
	overrides: ContextLimitOverrides = {},
	env: Record<string, string | undefined> = process.env,
): ContextLimits {
	const message = { ...DEFAULT_CONTEXT_LIMITS.message, ...overrides.message };
	const tool = { ...DEFAULT_CONTEXT_LIMITS.tool, ...overrides.tool };
	const explicitTool = new Set<keyof ToolContextLimits>(
		Object.keys(overrides.tool ?? {}) as Array<keyof ToolContextLimits>,
	);

	for (const key of Object.keys(message) as Array<keyof MessageContextLimits>) {
		const parse =
			key === "minOutdatedRewriteBytes"
				? parseNonNegativeEnv
				: parsePositiveEnv;
		const fromEnv = parse(env[MESSAGE_LIMIT_ENV[key]]);
		if (fromEnv !== undefined) message[key] = fromEnv;
	}
	for (const key of Object.keys(tool) as Array<keyof ToolContextLimits>) {
		const fromEnv = parsePositiveEnv(env[TOOL_LIMIT_ENV[key]]);
		if (fromEnv !== undefined) {
			tool[key] = fromEnv;
			explicitTool.add(key);
		}
	}

	const ceiling = Math.max(
		MIN_BUDGETED_OUTPUT_CHARS,
		message.toolResultChars - EXECUTOR_TRUNCATION_NOTICE_HEADROOM_CHARS,
	);
	for (const key of BUDGETED_OUTPUT_KEYS) {
		if (!explicitTool.has(key)) {
			tool[key] = Math.min(tool[key], ceiling);
		}
	}

	// Only a cap the caller set can push the forwarding cap up. Raising it to
	// clear a floored cap would override the smaller `toolResultChars` they
	// asked for, which is the same silent discard this branch avoids elsewhere.
	const explicitBudgetedCaps = BUDGETED_OUTPUT_KEYS.filter((key) =>
		explicitTool.has(key),
	).map((key) => tool[key]);
	if (explicitBudgetedCaps.length > 0) {
		message.toolResultChars = Math.max(
			message.toolResultChars,
			Math.max(...explicitBudgetedCaps) +
				EXECUTOR_TRUNCATION_NOTICE_HEADROOM_CHARS,
		);
	}

	return { message, tool };
}
