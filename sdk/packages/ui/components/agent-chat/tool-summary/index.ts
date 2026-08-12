/**
 * Shared, framework-free presentation logic for agent tool calls.
 *
 * Consumers (desktop app, cloud dashboard, future clients) feed the raw
 * `{ toolName, input, result }` payload of a tool call in and get back a
 * structured summary — label, per-item details, diff counts, extracted
 * output text — which they render with the agent-chat primitives
 * (`ToolActivityTrigger`, `ToolActivityDetails`, …) and their own icons.
 *
 * This module is pure data-in/data-out: no React, no DOM, no Node APIs, and
 * no dependency on runtime schemas. Inputs are `unknown` and parsing is
 * defensive; a malformed payload degrades to a generic label, never a throw.
 */

import { countDiffLines, makeUnifiedDiff } from "./diff.js";
import {
	extractOutputText,
	isRecord,
	normalizeValue,
	parseApplyPatchInput,
	parseAskQuestionInput,
	parseEditorInput,
	parseEditorResultDiffCounts,
	parseReadFilesInput,
	parseRunCommandsInput,
	parseSearchInput,
	parseSpawnAgentInput,
	parseWebFetchInput,
} from "./parsers.js";
import { detectLanguage, displayFileName, shortenPath } from "./paths.js";
import { pluralize, type ToolAggregate, teamSummary } from "./team.js";

export {
	countDiffLines,
	FRAGMENT_HUNK_HEADER,
	type MakeUnifiedDiffOptions,
	makeUnifiedDiff,
} from "./diff.js";
export {
	type ApplyPatchFile,
	type ApplyPatchInfo,
	type AskQuestionInfo,
	buildReadFilesKeys,
	type EditorInfo,
	extractOutputText,
	parseApplyPatchInput,
	parseAskQuestionInput,
	parseEditorInput,
	parseEditorResultDiffCounts,
	parseReadFilesInput,
	parseRunCommandsInput,
	parseSearchInput,
	parseSpawnAgentInput,
	parseWebFetchInput,
	type ReadFilesInfo,
	type RunCommandsInfo,
	type SearchInfo,
	type SpawnAgentInfo,
	type WebFetchInfo,
} from "./parsers.js";
export { detectLanguage, displayFileName, shortenPath } from "./paths.js";
export { type ToolAggregate, teamSummary } from "./team.js";

export type ToolSummaryPayload = {
	toolName: string;
	/** Structured input, or a JSON string of it (both are accepted). */
	input?: unknown;
	/** Raw tool result: string, content-block array, or record. */
	result?: unknown;
	isError?: boolean;
	inProgress?: boolean;
};

export type ToolKind =
	| "read"
	| "edit"
	| "command"
	| "search"
	| "web"
	| "spawn"
	| "team"
	| "skill"
	| "mcp"
	| "question"
	| "other";

export type ToolSummaryItem =
	| {
			type: "file";
			path: string;
			displayPath: string;
			startLine?: number;
			endLine?: number;
			language?: string;
			additions?: number;
			deletions?: number;
			/** Unified diff text for this file, when reconstructable. */
			diff?: string;
			/**
			 * Raw before/after texts for rich diff renderers (e.g.
			 * @pierre/diffs). `oldText` is absent for created files.
			 */
			oldText?: string;
			newText?: string;
			/**
			 * True when oldText/newText are fragments of the file rather than
			 * complete contents — renderers should hide absolute line numbers.
			 */
			fragment?: boolean;
			/**
			 * Per-hunk before/after texts when the change has more than one
			 * hunk (apply_patch). Render one diff per hunk — re-diffing
			 * concatenated hunks pairs deletions with unrelated additions.
			 * When present, prefer it over oldText/newText.
			 */
			hunks?: Array<{ oldText: string; newText: string }>;
	  }
	| { type: "command"; command: string }
	| { type: "query"; query: string }
	| { type: "url"; url: string }
	| { type: "text"; text: string };

/**
 * One styled segment of a row label. Segments with `code: true` carry code
 * (file names, commands, queries, URLs) and should render in a monospace
 * face; plain segments are prose.
 */
export type ToolLabelPart = { text: string; code?: boolean };

export type ToolSummary = {
	/** Normalized tool name (aliases applied). */
	toolName: string;
	kind: ToolKind;
	/** Row label, e.g. `Read app.tsx (10–80)` or `$ bun test`. */
	label: string;
	/** The label broken into styled segments; joins to `label`. */
	labelParts: ToolLabelPart[];
	/** Present when this call can merge into grouped-row counts. */
	aggregate?: ToolAggregate;
	/** Structured per-item detail for custom rendering. */
	items: ToolSummaryItem[];
	/** Preformatted one-per-line details for the expanded panel. */
	details: string[];
	/** Net line changes, for the trigger's +/- badge. */
	diff?: { additions: number; deletions: number };
	/** Human-readable text extracted from the result, when useful. */
	outputText?: string;
	/** Error text when the call failed. */
	errorText?: string;
};

export type ToolSummaryOptions = {
	/** How file paths render in labels/details. Default: "shortened". */
	pathStyle?: "shortened" | "basename" | "full";
	/** Cap on extracted output/error text. Default: 64 KiB. */
	maxOutputChars?: number;
	/**
	 * Optional cap on inline label text (commands, tasks, questions).
	 * Unlimited by default: labels carry the full text (whitespace collapsed
	 * to one line) and the consumer's layout ellipsizes at the container
	 * edge. Set a number only for width-constrained surfaces like TUIs.
	 */
	maxInlineChars?: number;
};

const DEFAULT_OPTIONS: Required<ToolSummaryOptions> = {
	pathStyle: "shortened",
	maxOutputChars: 64 * 1024,
	maxInlineChars: Number.POSITIVE_INFINITY,
};

export const TOOL_NAME_ALIASES: Record<string, string> = {
	"apply-patch": "apply_patch",
	bash: "run_commands",
	edit: "editor",
	edit_file: "editor",
	"file-read": "read_files",
	file_read: "read_files",
	read_file: "read_files",
	search: "search_codebase",
	"spawn-agent": "spawn_agent",
	spawn_agent_tool: "spawn_agent",
	"web-fetch": "fetch_web_content",
	web_fetch: "fetch_web_content",
};

export function normalizeToolName(toolName: string): string {
	const normalized = toolName.toLowerCase();
	return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

export function classifyTool(toolName: string): ToolKind {
	const name = normalizeToolName(toolName);
	if (name === "read_files") return "read";
	if (name === "editor" || name === "apply_patch") return "edit";
	if (name === "run_commands") return "command";
	if (name === "search_codebase") return "search";
	if (name === "fetch_web_content") return "web";
	if (name === "spawn_agent" || name.startsWith("subagent_")) return "spawn";
	if (name === "team" || name === "teams" || name.startsWith("team_"))
		return "team";
	if (name === "skills" || name === "skill") return "skill";
	if (name === "ask_question" || name === "ask_followup_question")
		return "question";
	if (name === "mcp" || name.startsWith("mcp_") || name.startsWith("mcp-"))
		return "mcp";
	// Fuzzy fallbacks for runtimes with their own tool names.
	if (name.includes("command") || name.includes("terminal")) return "command";
	if (name.includes("read")) return "read";
	if (name.includes("edit") || name.includes("write")) return "edit";
	if (name.includes("search") || name.includes("grep")) return "search";
	if (
		name.includes("browser") ||
		name.includes("fetch") ||
		name.includes("web")
	)
		return "web";
	if (name.includes("mcp")) return "mcp";
	return "other";
}

function truncate(text: string, maxLen: number): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLen) return collapsed;
	return `${collapsed.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function humanizeToolName(toolName: string): string {
	const cleaned = toolName
		.replace(/^mcp[-_]+/i, "")
		.replace(/[-_]+/g, " ")
		.trim();
	if (!cleaned) return toolName;
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatPath(
	path: string,
	style: Required<ToolSummaryOptions>["pathStyle"],
): string {
	if (style === "basename") return displayFileName(path);
	if (style === "full") return path;
	return shortenPath(path);
}

/** ` (10–80)` / ` (10+)` label suffix for a partial-file read. */
function lineRangeLabelSuffix(startLine?: number, endLine?: number): string {
	if (startLine !== undefined && endLine !== undefined)
		return ` (${startLine}–${endLine})`;
	if (startLine !== undefined) return ` (${startLine}+)`;
	if (endLine !== undefined) return ` (1–${endLine})`;
	return "";
}

/** `:10-80` detail suffix for a partial-file read. */
function lineRangeDetailSuffix(startLine?: number, endLine?: number): string {
	if (startLine !== undefined && endLine !== undefined)
		return `:${startLine}-${endLine}`;
	if (startLine !== undefined) return `:${startLine}+`;
	if (endLine !== undefined) return `:1-${endLine}`;
	return "";
}

function capText(
	text: string | undefined,
	maxChars: number,
): string | undefined {
	if (text === undefined) return undefined;
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[output truncated]`;
}

function extractErrorText(
	result: unknown,
	maxChars: number,
): string | undefined {
	const normalized = normalizeValue(result);
	if (isRecord(normalized) && typeof normalized.error === "string") {
		return capText(normalized.error, maxChars);
	}
	return capText(extractOutputText(normalized), maxChars);
}

function fallbackLabel(kind: ToolKind, toolName: string, inProgress: boolean) {
	switch (kind) {
		case "read":
			return inProgress ? "Reading file" : "Read file";
		case "edit":
			return inProgress ? "Editing file" : "Edited file";
		case "command":
			return inProgress ? "Running command" : "Ran command";
		case "search":
			return inProgress ? "Searching" : "Searched";
		case "web":
			return inProgress ? "Fetching web content" : "Fetched web content";
		case "spawn":
			return inProgress ? "Spawning agent" : "Spawned agent";
		case "skill":
			return inProgress ? "Using skill" : "Used skill";
		case "question":
			return inProgress ? "Asking a question" : "Asked a question";
		case "mcp":
			return inProgress ? "Calling MCP tool" : "Called MCP tool";
		default:
			return inProgress
				? `Running ${humanizeToolName(toolName)}`
				: humanizeToolName(toolName);
	}
}

const READ_AGGREGATE = {
	key: "read-files",
	noun: "file",
	completedVerb: "Read",
	progressVerb: "Reading",
} as const;
const EDIT_AGGREGATE = {
	key: "edited-files",
	noun: "file",
	completedVerb: "Edited",
	progressVerb: "Editing",
} as const;
const COMMAND_AGGREGATE = {
	key: "commands",
	noun: "command",
	completedVerb: "Ran",
	progressVerb: "Running",
} as const;
const SEARCH_AGGREGATE = {
	key: "searches",
	noun: "search",
	pluralNoun: "searches",
	completedVerb: "Explored",
	progressVerb: "Exploring",
} as const;
const WEB_AGGREGATE = {
	key: "links",
	noun: "link",
	completedVerb: "Explored",
	progressVerb: "Exploring",
} as const;
const SPAWN_AGGREGATE = {
	key: "spawned-agents",
	noun: "agent",
	completedVerb: "Spawned",
	progressVerb: "Spawning",
} as const;

function aggregateLabel(
	aggregate: Omit<ToolAggregate, "count">,
	count: number,
	inProgress: boolean,
): string {
	const verb = inProgress ? aggregate.progressVerb : aggregate.completedVerb;
	return `${verb} ${pluralize(count, aggregate.noun, aggregate.pluralNoun)}`;
}

/** Derive the plain-text label and its styled segments together. */
function labeled(
	parts: ToolLabelPart[],
): Pick<ToolSummary, "label" | "labelParts"> {
	return { label: parts.map((part) => part.text).join(""), labelParts: parts };
}

// Fallback summaries (unparsable or absent input) still carry an aggregate
// so consecutive calls merge into grouped counts ("Spawned 3 agents") rather
// than repeating the generic label.
const FALLBACK_AGGREGATES: Partial<
	Record<ToolKind, Omit<ToolAggregate, "count">>
> = {
	command: COMMAND_AGGREGATE,
	edit: EDIT_AGGREGATE,
	read: READ_AGGREGATE,
	search: SEARCH_AGGREGATE,
	spawn: SPAWN_AGGREGATE,
	web: WEB_AGGREGATE,
};

/**
 * Build the presentation summary for one tool call.
 *
 * Single-item calls carry their specifics inline in the label
 * (`Read app.tsx (10–80)`, `Ran bun test`, `Edited chat-view.tsx`); calls
 * over multiple items aggregate (`Read 3 files`) with per-item lines in
 * `details`. Never throws on malformed input.
 */
export function buildToolSummary(
	payload: ToolSummaryPayload,
	options?: ToolSummaryOptions,
): ToolSummary {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const toolName = normalizeToolName(payload.toolName || "tool");
	const kind = classifyTool(toolName);
	const inProgress = payload.inProgress ?? false;
	const isError = payload.isError ?? false;
	const input = normalizeValue(payload.input);
	const fallbackAggregate = FALLBACK_AGGREGATES[kind];
	const base: ToolSummary = {
		toolName,
		kind,
		...labeled([{ text: fallbackLabel(kind, toolName, inProgress) }]),
		aggregate: fallbackAggregate
			? { ...fallbackAggregate, count: 1 }
			: undefined,
		items: [],
		details: [],
	};
	if (isError) {
		base.errorText = extractErrorText(payload.result, opts.maxOutputChars);
	}

	if (kind === "team") {
		const team = teamSummary(
			toolName,
			input,
			payload.result,
			inProgress,
			isError,
		);
		if (team) {
			return {
				...base,
				...labeled([{ text: team.label }]),
				aggregate: team.aggregate,
				details: team.details,
				items: team.details.map((text) => ({ type: "text", text })),
			};
		}
	}

	if (toolName === "read_files") {
		const info = parseReadFilesInput(input);
		if (info) {
			const items: ToolSummaryItem[] = info.files.map((file) => ({
				type: "file",
				path: file.path,
				displayPath: formatPath(file.path, opts.pathStyle),
				startLine: file.startLine,
				endLine: file.endLine,
				language: detectLanguage(file.path),
			}));
			const single = info.files.length === 1 ? info.files[0] : null;
			return {
				...base,
				...labeled(
					single
						? [
								{ text: `${inProgress ? "Reading" : "Read"} file ` },
								{
									text: `${displayFileName(single.path)}${lineRangeLabelSuffix(single.startLine, single.endLine)}`,
									code: true,
								},
							]
						: [
								{
									text: aggregateLabel(
										READ_AGGREGATE,
										info.files.length,
										inProgress,
									),
								},
							],
				),
				aggregate: { ...READ_AGGREGATE, count: info.files.length },
				items,
				details: info.files.map(
					(file) =>
						`${formatPath(file.path, opts.pathStyle)}${lineRangeDetailSuffix(file.startLine, file.endLine)}`,
				),
			};
		}
	}

	if (toolName === "run_commands") {
		const info = parseRunCommandsInput(input);
		if (info) {
			const commands = info.commands.map((command) => command.trim());
			const singleInline =
				commands.length === 1
					? truncate(commands[0], opts.maxInlineChars)
					: null;
			return {
				...base,
				// Single commands lead with the action, command in mono after.
				...labeled(
					singleInline !== null
						? [
								{ text: `${inProgress ? "Running" : "Ran"} command ` },
								{ text: singleInline, code: true },
							]
						: [
								{
									text: aggregateLabel(
										COMMAND_AGGREGATE,
										commands.length,
										inProgress,
									),
								},
							],
				),
				aggregate: { ...COMMAND_AGGREGATE, count: commands.length },
				items: commands.map((command) => ({ type: "command", command })),
				// The label may be ellipsized by the consumer's layout, so the
				// expanded panel always carries the full command text.
				details: commands,
				outputText: isError
					? undefined
					: capText(extractOutputText(payload.result), opts.maxOutputChars),
			};
		}
	}

	if (toolName === "search_codebase") {
		const info = parseSearchInput(input);
		if (info) {
			return {
				...base,
				...labeled(
					info.queries.length === 1
						? [
								{ text: `${inProgress ? "Searching" : "Searched"} ` },
								{
									text: truncate(info.queries[0], opts.maxInlineChars),
									code: true,
								},
							]
						: [
								{
									text: aggregateLabel(
										SEARCH_AGGREGATE,
										info.queries.length,
										inProgress,
									),
								},
							],
				),
				aggregate: { ...SEARCH_AGGREGATE, count: info.queries.length },
				items: info.queries.map((query) => ({ type: "query", query })),
				details: info.queries,
			};
		}
	}

	if (toolName === "fetch_web_content") {
		const info = parseWebFetchInput(input);
		if (info) {
			return {
				...base,
				...labeled(
					info.urls.length === 1
						? [
								{ text: `${inProgress ? "Fetching" : "Fetched"} ` },
								{
									text: truncate(info.urls[0], opts.maxInlineChars),
									code: true,
								},
							]
						: [
								{
									text: aggregateLabel(
										WEB_AGGREGATE,
										info.urls.length,
										inProgress,
									),
								},
							],
				),
				aggregate: { ...WEB_AGGREGATE, count: info.urls.length },
				items: info.urls.map((url) => ({ type: "url", url })),
				details: info.urls,
			};
		}
	}

	if (toolName === "apply_patch") {
		const info = parseApplyPatchInput(input);
		if (info) {
			const single = info.files.length === 1 ? info.files[0] : null;
			const actionVerb = (action: "add" | "update" | "delete") =>
				action === "add"
					? inProgress
						? "Creating file"
						: "Created file"
					: action === "delete"
						? inProgress
							? "Deleting file"
							: "Deleted file"
						: inProgress
							? "Editing file"
							: "Edited file";
			// Renames display as `old → new`.
			const fileLabel = (file: (typeof info.files)[number]) =>
				file.movedTo
					? `${displayFileName(file.path)} → ${displayFileName(file.movedTo)}`
					: displayFileName(file.path);
			const filePathDetail = (file: (typeof info.files)[number]) =>
				file.movedTo
					? `${formatPath(file.path, opts.pathStyle)} → ${formatPath(file.movedTo, opts.pathStyle)}`
					: formatPath(file.path, opts.pathStyle);
			return {
				...base,
				...labeled(
					single
						? [
								{ text: `${actionVerb(single.action)} ` },
								{ text: fileLabel(single), code: true },
							]
						: [
								{
									text: aggregateLabel(
										EDIT_AGGREGATE,
										info.files.length,
										inProgress,
									),
								},
							],
				),
				aggregate: { ...EDIT_AGGREGATE, count: info.files.length },
				diff: { additions: info.additions, deletions: info.deletions },
				items: info.files.map((file) => ({
					type: "file",
					path: file.movedTo ?? file.path,
					displayPath: formatPath(file.movedTo ?? file.path, opts.pathStyle),
					language: detectLanguage(file.movedTo ?? file.path),
					additions: file.additions,
					deletions: file.deletions,
					diff: file.diff,
					// Deletions have no meaningful rich diff; single-hunk changes
					// expose plain texts, multi-hunk changes must render per hunk.
					oldText:
						file.action !== "delete" && file.hunks.length === 1
							? file.action === "add"
								? undefined
								: file.hunks[0].oldText
							: undefined,
					newText:
						file.action !== "delete" && file.hunks.length === 1
							? file.hunks[0].newText
							: undefined,
					hunks:
						file.action !== "delete" && file.hunks.length > 1
							? file.hunks
							: undefined,
					fragment: file.action !== "add",
				})),
				details: info.files.map((file) =>
					file.action === "delete"
						? `Deleted ${filePathDetail(file)}`
						: `${filePathDetail(file)} +${file.additions} -${file.deletions}`,
				),
			};
		}
		return {
			...base,
			...labeled([{ text: inProgress ? "Applying patch" : "Applied patch" }]),
			aggregate: { ...EDIT_AGGREGATE, count: 1 },
		};
	}

	if (toolName === "editor") {
		const info = parseEditorInput(input);
		const inputRecord = isRecord(input) ? input : null;
		const path =
			info?.path ??
			(typeof inputRecord?.path === "string" ? inputRecord.path : undefined);
		// The editor schema has no `command`; derive the action from the shape.
		const command =
			typeof inputRecord?.command === "string"
				? inputRecord.command
				: inputRecord?.insert_line != null
					? "insert"
					: typeof inputRecord?.old_text === "string"
						? "str_replace"
						: typeof inputRecord?.new_text === "string"
							? "create"
							: "edit";
		const verb = inProgress
			? command === "create"
				? "Creating file"
				: command === "insert"
					? "Inserting into"
					: "Editing file"
			: command === "create"
				? "Created file"
				: command === "insert"
					? "Inserted into"
					: "Edited file";

		let diff: ToolSummary["diff"];
		let diffText: string | undefined;
		if (info && (info.oldText !== undefined || command === "create")) {
			// str_replace texts are fragments of the file, not whole contents;
			// fragment mode keeps the hunk header from claiming line positions.
			diffText = makeUnifiedDiff(
				info.oldText ?? "",
				info.newText,
				info.path,
				3,
				{
					fragment: command !== "create",
				},
			);
			diff = countDiffLines(diffText);
		} else {
			diff = parseEditorResultDiffCounts(payload.result) ?? undefined;
		}

		if (path) {
			return {
				...base,
				...labeled([
					{ text: `${verb} ` },
					{ text: displayFileName(path), code: true },
				]),
				aggregate: { ...EDIT_AGGREGATE, count: 1 },
				diff,
				items: [
					{
						type: "file",
						path,
						displayPath: formatPath(path, opts.pathStyle),
						language: detectLanguage(path),
						additions: diff?.additions,
						deletions: diff?.deletions,
						diff: diffText,
						oldText: info?.oldText,
						newText: info?.newText,
						fragment: command !== "create",
					},
				],
				// The label carries the basename; the expanded panel leads with
				// the fuller path above the diff, matching read rows.
				details: [formatPath(path, opts.pathStyle)],
			};
		}
	}

	if (toolName === "spawn_agent" || toolName.startsWith("subagent_")) {
		const info = parseSpawnAgentInput(input);
		if (info) {
			return {
				...base,
				...labeled([
					{ text: `${inProgress ? "Spawning" : "Spawned"} agent: ` },
					{ text: truncate(info.task, opts.maxInlineChars) },
				]),
				aggregate: { ...SPAWN_AGGREGATE, count: 1 },
				items: [{ type: "text", text: info.task }],
				details: [info.task],
			};
		}
	}

	if (kind === "skill") {
		const record = isRecord(input) ? input : null;
		const skill = typeof record?.skill === "string" ? record.skill : "";
		const args = typeof record?.args === "string" ? record.args : "";
		if (skill) {
			const detail = args ? `${skill} ${args}` : skill;
			return {
				...base,
				...labeled([
					{ text: `${inProgress ? "Using" : "Used"} skill ` },
					{ text: truncate(skill, opts.maxInlineChars), code: true },
				]),
				items: [{ type: "text", text: detail }],
				details: [detail],
			};
		}
	}

	if (kind === "question") {
		const info = parseAskQuestionInput(input);
		if (info) {
			return {
				...base,
				...labeled([
					{
						text: `${inProgress ? "Asking" : "Asked"} "${truncate(info.question, opts.maxInlineChars)}"`,
					},
				]),
				items: [
					{ type: "text", text: info.question },
					...info.options.map((option): ToolSummaryItem => {
						return { type: "text", text: option };
					}),
				],
				details: info.options,
				outputText: isError
					? undefined
					: capText(extractOutputText(payload.result), opts.maxOutputChars),
			};
		}
	}

	// Unknown/MCP tools: humanized name, plus whatever text the result holds.
	const normalizedResult = normalizeValue(payload.result);
	const resultRecord = isRecord(normalizedResult) ? normalizedResult : null;
	const query =
		typeof resultRecord?.query === "string" ? resultRecord.query : "";
	return {
		...base,
		...(query ? labeled([{ text: truncate(query, opts.maxInlineChars) }]) : {}),
		outputText: isError
			? undefined
			: capText(extractOutputText(normalizedResult), opts.maxOutputChars),
	};
}

/**
 * Merge the labels of consecutive tool calls into one grouped-row label.
 * Adjacent same-kind aggregates merge their counts ("Read 3 files"); other
 * labels pass through, joined with " · ".
 */
export function buildGroupedToolLabel(
	summaries: Array<{
		label: string;
		aggregate?: ToolAggregate;
		inProgress?: boolean;
	}>,
): string {
	if (summaries.length === 1) {
		return summaries[0]?.label ?? "Tool";
	}

	type Segment =
		| { type: "label"; label: string }
		| { type: "aggregate"; aggregate: ToolAggregate & { inProgress: boolean } };
	const segments: Segment[] = [];
	for (const summary of summaries) {
		const aggregate = summary.aggregate;
		if (!aggregate) {
			segments.push({ type: "label", label: summary.label });
			continue;
		}

		const previous = segments.at(-1);
		if (
			previous?.type === "aggregate" &&
			previous.aggregate.key === aggregate.key
		) {
			segments[segments.length - 1] = {
				type: "aggregate",
				aggregate: {
					...previous.aggregate,
					count: previous.aggregate.count + aggregate.count,
					inProgress:
						previous.aggregate.inProgress || (summary.inProgress ?? false),
				},
			};
			continue;
		}

		segments.push({
			type: "aggregate",
			aggregate: { ...aggregate, inProgress: summary.inProgress ?? false },
		});
	}

	return segments
		.map((segment) => {
			if (segment.type === "label") return segment.label;
			const { aggregate } = segment;
			const verb = aggregate.inProgress
				? aggregate.progressVerb
				: aggregate.completedVerb;
			return `${verb} ${pluralize(
				aggregate.count,
				aggregate.noun,
				aggregate.pluralNoun,
			)}`;
		})
		.join(" · ");
}
