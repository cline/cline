import { FRAGMENT_HUNK_HEADER, hunkHeader } from "./diff.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Tool inputs and results sometimes arrive as JSON strings rather than
 * structured objects (archived transcripts, some transports). Re-parse
 * anything that looks like serialized JSON; leave other values untouched.
 */
export function normalizeValue(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	) {
		try {
			return JSON.parse(trimmed) as unknown;
		} catch {
			return value;
		}
	}
	return value;
}

export interface ReadFilesInfo {
	files: { path: string; startLine?: number; endLine?: number }[];
}

/**
 * read_files accepts many input shapes across runtimes: `{ files: [{ path,
 * start_line, end_line }] }`, `{ files: "path" }`, `{ file_paths: [...] }`,
 * `{ paths: [...] }`, a bare array, or a bare string.
 */
export function parseReadFilesInput(input: unknown): ReadFilesInfo | undefined {
	const normalized = normalizeValue(input);
	const files: ReadFilesInfo["files"] = [];
	const push = (value: unknown) => {
		if (typeof value === "string" && value.length > 0) {
			files.push({ path: value });
			return;
		}
		if (isRecord(value) && typeof value.path === "string" && value.path) {
			files.push({
				path: value.path,
				startLine:
					typeof value.start_line === "number" ? value.start_line : undefined,
				endLine:
					typeof value.end_line === "number" ? value.end_line : undefined,
			});
		}
	};

	const record = isRecord(normalized) ? normalized : null;
	const candidates =
		record?.files ?? record?.file_paths ?? record?.paths ?? normalized;
	if (Array.isArray(candidates)) {
		for (const candidate of candidates) push(candidate);
	} else {
		push(candidates);
	}
	return files.length > 0 ? { files } : undefined;
}

// A read_files call can list the same path more than once, so the raw path is
// not a unique key. Prefix the array index to keep keys unique per row.
export function buildReadFilesKeys(files: { path: string }[]): string[] {
	return files.map((f, i) => `${i}:${f.path}`);
}

export interface RunCommandsInfo {
	commands: string[];
}

/**
 * run_commands accepts every shape in core's RunCommandsInputUnionSchema:
 * `{ commands: [...] }` (strings or `{ command, args }` entries, or a single
 * entry instead of an array), a bare array of either, a top-level
 * `{ command, args }`, `{ cmd }`, or a bare string.
 */
export function parseRunCommandsInput(
	input: unknown,
): RunCommandsInfo | undefined {
	const normalized = normalizeValue(input);
	const commands: string[] = [];
	const pushEntry = (entry: unknown) => {
		if (typeof entry === "string" && entry.length > 0) {
			commands.push(entry);
			return;
		}
		if (isRecord(entry) && typeof entry.command === "string" && entry.command) {
			const args = Array.isArray(entry.args)
				? entry.args.filter((a): a is string => typeof a === "string").join(" ")
				: "";
			commands.push(args ? `${entry.command} ${args}` : entry.command);
		}
	};

	if (typeof normalized === "string" || Array.isArray(normalized)) {
		for (const entry of Array.isArray(normalized) ? normalized : [normalized]) {
			pushEntry(entry);
		}
	} else if (isRecord(normalized)) {
		if (normalized.commands !== undefined) {
			const raw = normalized.commands;
			for (const entry of Array.isArray(raw) ? raw : [raw]) {
				pushEntry(entry);
			}
		} else if (typeof normalized.command === "string") {
			pushEntry(normalized);
		} else if (typeof normalized.cmd === "string") {
			pushEntry(normalized.cmd);
		}
	}
	return commands.length > 0 ? { commands } : undefined;
}

export interface EditorInfo {
	path: string;
	oldText?: string;
	newText: string;
	insertLine?: number;
}

export function parseEditorInput(input: unknown): EditorInfo | undefined {
	const normalized = normalizeValue(input);
	if (!isRecord(normalized)) return undefined;
	if (typeof normalized.path !== "string") return undefined;
	if (typeof normalized.new_text !== "string") return undefined;

	return {
		path: normalized.path,
		oldText:
			typeof normalized.old_text === "string" ? normalized.old_text : undefined,
		newText: normalized.new_text,
		insertLine:
			typeof normalized.insert_line === "number"
				? normalized.insert_line
				: undefined,
	};
}

export interface SearchInfo {
	queries: string[];
}

export function parseSearchInput(input: unknown): SearchInfo | undefined {
	const normalized = normalizeValue(input);
	if (!isRecord(normalized)) return undefined;
	if (!Array.isArray(normalized.queries)) return undefined;
	const queries = normalized.queries.filter(
		(q): q is string => typeof q === "string" && q.length > 0,
	);
	return queries.length > 0 ? { queries } : undefined;
}

export interface WebFetchInfo {
	urls: string[];
}

export function parseWebFetchInput(input: unknown): WebFetchInfo | undefined {
	const normalized = normalizeValue(input);
	if (!isRecord(normalized)) return undefined;
	if (!Array.isArray(normalized.requests)) return undefined;
	const urls = normalized.requests
		.filter((r): r is Record<string, unknown> => isRecord(r))
		.map((r) => (typeof r.url === "string" ? r.url : ""))
		.filter(Boolean);
	return urls.length > 0 ? { urls } : undefined;
}

export interface SpawnAgentInfo {
	task: string;
}

export function parseSpawnAgentInput(
	input: unknown,
): SpawnAgentInfo | undefined {
	const normalized = normalizeValue(input);
	if (!isRecord(normalized)) return undefined;
	if (typeof normalized.task !== "string") return undefined;
	return { task: normalized.task };
}

export interface AskQuestionInfo {
	question: string;
	options: string[];
}

export function parseAskQuestionInput(
	input: unknown,
): AskQuestionInfo | undefined {
	const normalized = normalizeValue(input);
	if (!isRecord(normalized)) return undefined;
	if (typeof normalized.question !== "string") return undefined;
	const options = Array.isArray(normalized.options)
		? normalized.options.filter((o): o is string => typeof o === "string")
		: [];
	return { question: normalized.question, options };
}

/** Before/after texts reconstructed from one `@@`-delimited patch section. */
export interface ApplyPatchHunk {
	oldText: string;
	newText: string;
}

export interface ApplyPatchFile {
	path: string;
	/** From the section header: `Add File`, `Update File`, or `Delete File`. */
	action: "add" | "update" | "delete";
	/** Destination path from a `*** Move to:` line, when the file was renamed. */
	movedTo?: string;
	additions: number;
	deletions: number;
	diff: string;
	/**
	 * Per-hunk before/after texts, boundaries preserved. Rendering each hunk
	 * separately matters: concatenating hunks and re-diffing would let a
	 * deletion in one hunk pair up with an addition in another.
	 */
	hunks: ApplyPatchHunk[];
}

export interface ApplyPatchInfo {
	files: ApplyPatchFile[];
	additions: number;
	deletions: number;
	diff: string;
}

const FILE_ACTION_RE = /^\*\*\* (Add|Update|Delete) File: (.+)/;
const MOVE_TO_RE = /^\*\*\* Move to: (.+)/;
// `@@ …` context markers delimit hunks and are handled separately below.
const HUNK_MARKER_RE = /^@@/;
const SKIP_LINES =
	/^(?:\*\*\* (?:Begin|End) Patch|%%bash|```|EOF|apply_patch\b|\*\*\* End of File)/;

/**
 * Parse the apply_patch envelope (`*** Add/Update/Delete File:` sections)
 * into per-file additions/deletions and a synthetic unified diff.
 */
export function parseApplyPatchInput(
	input: unknown,
): ApplyPatchInfo | undefined {
	const normalized = normalizeValue(input);
	const raw =
		typeof normalized === "string"
			? normalized
			: isRecord(normalized) && typeof normalized.input === "string"
				? normalized.input
				: null;
	if (!raw) return undefined;

	const files: ApplyPatchFile[] = [];
	let current: {
		path: string;
		action: "add" | "update" | "delete";
		movedTo?: string;
		lines: string[];
		hunk: string[];
		oldLines: string[];
		newLines: string[];
		hunks: ApplyPatchHunk[];
		additions: number;
		deletions: number;
	} | null = null;

	const flushHunk = () => {
		if (!current || current.hunk.length === 0) return;
		// Update/Delete sections are file fragments; only Add File sections
		// carry complete contents, so only they get real hunk positions.
		current.lines.push(
			current.action === "add"
				? hunkHeader(current.hunk)
				: FRAGMENT_HUNK_HEADER,
			...current.hunk,
		);
		current.hunks.push({
			oldText: current.oldLines.join("\n"),
			newText: current.newLines.join("\n"),
		});
		current.hunk = [];
		current.oldLines = [];
		current.newLines = [];
	};
	const flushFile = () => {
		if (!current) return;
		flushHunk();
		files.push({
			path: current.path,
			action: current.action,
			movedTo: current.movedTo,
			additions: current.additions,
			deletions: current.deletions,
			diff: current.lines.join("\n"),
			hunks: current.hunks,
		});
		current = null;
	};

	for (const line of raw.split("\n")) {
		const fileMatch = FILE_ACTION_RE.exec(line);
		if (fileMatch) {
			flushFile();
			const path = fileMatch[2].trim();
			current = {
				path,
				action: fileMatch[1].toLowerCase() as "add" | "update" | "delete",
				lines: [`--- a/${path}`, `+++ b/${path}`],
				hunk: [],
				oldLines: [],
				newLines: [],
				hunks: [],
				additions: 0,
				deletions: 0,
			};
			continue;
		}
		const moveMatch = MOVE_TO_RE.exec(line);
		if (moveMatch) {
			if (current) current.movedTo = moveMatch[1].trim();
			continue;
		}
		if (HUNK_MARKER_RE.test(line.trim())) {
			flushHunk();
			continue;
		}
		if (SKIP_LINES.test(line.trim())) continue;
		if (!current) continue;

		if (line.startsWith("+")) {
			current.additions++;
			current.newLines.push(line.slice(1));
		} else if (line.startsWith("-")) {
			current.deletions++;
			current.oldLines.push(line.slice(1));
		} else {
			const context = line.startsWith(" ") ? line.slice(1) : line;
			current.oldLines.push(context);
			current.newLines.push(context);
		}

		if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
			current.hunk.push(line);
		} else {
			current.hunk.push(` ${line}`);
		}
	}
	flushFile();

	if (files.length === 0) return undefined;
	return {
		files,
		additions: files.reduce((sum, f) => sum + f.additions, 0),
		deletions: files.reduce((sum, f) => sum + f.deletions, 0),
		diff: files.map((f) => f.diff).join("\n"),
	};
}

/**
 * The editor tool's result text encodes changed lines as `+12: …` / `-12: …`.
 * Used as a fallback when the input texts are unavailable for diffing.
 */
export function parseEditorResultDiffCounts(
	result: unknown,
): { additions: number; deletions: number } | null {
	const normalized = normalizeValue(result);
	const value = isRecord(normalized) ? normalized.result : normalized;
	if (typeof value !== "string") return null;
	let additions = 0;
	let deletions = 0;
	for (const line of value.split("\n")) {
		if (/^\+\d+:/.test(line)) additions += 1;
		if (/^-\d+:/.test(line)) deletions += 1;
	}
	if (additions === 0 && deletions === 0) return null;
	return { additions, deletions };
}

// Base64 payloads are one giant line; chunk to MIME width so line-based
// collapsed previews stay compact and expand shows the full data.
function chunkBase64(data: string): string {
	return data.match(/.{1,76}/g)?.join("\n") ?? data;
}

/**
 * Extract human-readable text from a tool result: plain strings,
 * `[{ result }]` arrays, and MCP `{ content: [...] }` shapes (text,
 * resource, resource_link, image/audio blocks) are all handled.
 */
export function extractOutputText(raw: unknown): string | undefined {
	if (raw === null || raw === undefined) return undefined;
	if (typeof raw === "string") return raw;

	if (Array.isArray(raw)) {
		const parts: string[] = [];
		for (const item of raw) {
			if (isRecord(item) && "result" in item) {
				const result = item.result;
				if (typeof result === "string") {
					parts.push(result);
				} else if (Array.isArray(result)) {
					for (const part of result) {
						if (
							isRecord(part) &&
							(part as { type?: string }).type === "text" &&
							"text" in part
						) {
							parts.push(String(part.text));
						}
					}
				}
			}
		}
		if (parts.length > 0) return parts.join("\n");
	}

	if (typeof raw === "object") {
		// MCP tools return {content: [{type: "text", text}, ...]}. Extract the
		// text so multi-line results keep real newlines instead of being
		// JSON-escaped into one giant line. Non-text blocks keep their
		// identifying metadata plus their base64 payloads so mixed results are
		// not silently truncated.
		const content = (raw as { content?: unknown }).content;
		if (Array.isArray(content)) {
			const parts = content
				.map((part) => {
					if (!isRecord(part)) return "";
					if (part.type === "text" && typeof part.text === "string") {
						return part.text;
					}
					if (part.type === "resource" && isRecord(part.resource)) {
						if (typeof part.resource.text === "string") {
							return part.resource.text;
						}
						if (typeof part.resource.blob === "string" && part.resource.blob) {
							const label =
								typeof part.resource.uri === "string"
									? `[resource: ${part.resource.uri}]`
									: "[resource]";
							return `${label}\n${chunkBase64(part.resource.blob)}`;
						}
						if (typeof part.resource.uri === "string") {
							return `[resource: ${part.resource.uri}]`;
						}
					}
					if (part.type === "resource_link" && typeof part.uri === "string") {
						return `[resource_link: ${part.uri}]`;
					}
					if (
						(part.type === "image" || part.type === "audio") &&
						typeof part.mimeType === "string"
					) {
						if (typeof part.data === "string" && part.data) {
							return `[${part.type}: ${part.mimeType}]\n${chunkBase64(part.data)}`;
						}
						return `[${part.type}: ${part.mimeType}]`;
					}
					return typeof part.type === "string" ? `[${part.type}]` : "";
				})
				.filter(Boolean);
			if (parts.length > 0) return parts.join("\n");
		}
		try {
			return JSON.stringify(raw, null, 2);
		} catch {
			return String(raw);
		}
	}

	return String(raw);
}
