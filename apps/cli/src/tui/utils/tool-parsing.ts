import { basename, extname } from "node:path";
import { hunkHeader } from "./diff";

const EXT_TO_LANGUAGE: Record<string, string> = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".jsx": "jsx",
	".py": "python",
	".rb": "ruby",
	".rs": "rust",
	".go": "go",
	".java": "java",
	".kt": "kotlin",
	".swift": "swift",
	".c": "c",
	".cpp": "cpp",
	".h": "c",
	".hpp": "cpp",
	".cs": "csharp",
	".css": "css",
	".scss": "scss",
	".html": "html",
	".vue": "vue",
	".svelte": "svelte",
	".json": "json",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".md": "markdown",
	".sql": "sql",
	".sh": "bash",
	".bash": "bash",
	".zsh": "bash",
	".fish": "fish",
	".lua": "lua",
	".php": "php",
	".r": "r",
	".ex": "elixir",
	".exs": "elixir",
	".erl": "erlang",
	".zig": "zig",
	".dockerfile": "dockerfile",
	".xml": "xml",
	".graphql": "graphql",
	".proto": "protobuf",
};

export function detectLanguage(filePath: string): string | undefined {
	const ext = extname(filePath).toLowerCase();
	if (ext && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];
	const base = basename(filePath).toLowerCase();
	if (base === "dockerfile") return "dockerfile";
	if (base === "makefile") return "makefile";
	if (base === "cmakelists.txt") return "cmake";
	return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

export interface ReadFilesInfo {
	files: { path: string; startLine?: number; endLine?: number }[];
}

export function parseReadFilesInput(input: unknown): ReadFilesInfo | undefined {
	if (!isRecord(input)) return undefined;

	if (Array.isArray(input.file_paths)) {
		return {
			files: input.file_paths
				.filter((p): p is string => typeof p === "string")
				.map((path) => ({ path })),
		};
	}

	if (Array.isArray(input.files)) {
		return {
			files: input.files
				.filter((f): f is Record<string, unknown> => isRecord(f))
				.map((f) => ({
					path: String(f.path ?? ""),
					startLine:
						typeof f.start_line === "number" ? f.start_line : undefined,
					endLine: typeof f.end_line === "number" ? f.end_line : undefined,
				})),
		};
	}

	return undefined;
}

export interface RunCommandsInfo {
	commands: string[];
}

export function parseRunCommandsInput(
	input: unknown,
): RunCommandsInfo | undefined {
	if (!isRecord(input)) {
		if (typeof input === "string") return { commands: [input] };
		return undefined;
	}

	if (Array.isArray(input.commands)) {
		return {
			commands: input.commands.map((cmd) => {
				if (typeof cmd === "string") return cmd;
				if (isRecord(cmd) && typeof cmd.command === "string") {
					const args = Array.isArray(cmd.args) ? cmd.args.join(" ") : "";
					return args ? `${cmd.command} ${args}` : cmd.command;
				}
				return String(cmd);
			}),
		};
	}

	return undefined;
}

export interface EditorInfo {
	path: string;
	oldText?: string;
	newText: string;
	insertLine?: number;
}

export function parseEditorInput(input: unknown): EditorInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (typeof input.path !== "string") return undefined;
	if (typeof input.new_text !== "string") return undefined;

	return {
		path: input.path,
		oldText: typeof input.old_text === "string" ? input.old_text : undefined,
		newText: input.new_text,
		insertLine:
			typeof input.insert_line === "number" ? input.insert_line : undefined,
	};
}

export interface SearchInfo {
	queries: string[];
}

export function parseSearchInput(input: unknown): SearchInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (!Array.isArray(input.queries)) return undefined;
	return {
		queries: input.queries.filter((q): q is string => typeof q === "string"),
	};
}

export interface WebFetchInfo {
	urls: string[];
}

export function parseWebFetchInput(input: unknown): WebFetchInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (!Array.isArray(input.requests)) return undefined;
	return {
		urls: input.requests
			.filter((r): r is Record<string, unknown> => isRecord(r))
			.map((r) => String(r.url ?? ""))
			.filter(Boolean),
	};
}

export interface SpawnAgentInfo {
	task: string;
}

export function parseSpawnAgentInput(
	input: unknown,
): SpawnAgentInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (typeof input.task !== "string") return undefined;
	return { task: input.task };
}

export function extractFullOutputText(raw: unknown): string | undefined {
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
		try {
			return JSON.stringify(raw, null, 2);
		} catch {
			return String(raw);
		}
	}

	return String(raw);
}

export interface AskQuestionInfo {
	question: string;
	options: string[];
}

export function parseAskQuestionInput(
	input: unknown,
): AskQuestionInfo | undefined {
	if (!isRecord(input)) return undefined;
	if (typeof input.question !== "string") return undefined;
	const options = Array.isArray(input.options)
		? input.options.filter((o): o is string => typeof o === "string")
		: [];
	return { question: input.question, options };
}

export interface ApplyPatchInfo {
	files: string[];
	additions: number;
	deletions: number;
	diff: string;
}

const FILE_ACTION_RE = /^\*\*\* (?:Add|Update|Delete) File: (.+)/;
const SKIP_LINES =
	/^(?:\*\*\* (?:Begin|End) Patch|%%bash|```|EOF|apply_patch\b|@@|\*\*\* (?:Move to:|End of File))/;

export function parseApplyPatchInput(
	input: unknown,
): ApplyPatchInfo | undefined {
	const raw =
		typeof input === "string"
			? input
			: isRecord(input) && typeof input.input === "string"
				? input.input
				: null;
	if (!raw) return undefined;

	const files: string[] = [];
	const out: string[] = [];
	let hunk: string[] = [];
	let additions = 0;
	let deletions = 0;

	const flush = () => {
		if (hunk.length === 0) return;
		out.push(hunkHeader(hunk), ...hunk);
		hunk = [];
	};

	for (const line of raw.split("\n")) {
		const fileMatch = FILE_ACTION_RE.exec(line);
		if (fileMatch) {
			flush();
			const path = fileMatch[1].trim();
			files.push(path);
			out.push(`--- a/${path}`, `+++ b/${path}`);
			continue;
		}
		if (SKIP_LINES.test(line.trim())) continue;

		if (line.startsWith("+")) additions++;
		else if (line.startsWith("-")) deletions++;

		if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
			hunk.push(line);
		} else {
			hunk.push(` ${line}`);
		}
	}
	flush();

	if (files.length === 0) return undefined;
	return { files, additions, deletions, diff: out.join("\n") };
}

export function shortenPath(filePath: string, maxLen = 50): string {
	if (filePath.length <= maxLen) return filePath;
	const parts = filePath.split("/");
	const fileName = parts.pop() ?? "";
	if (fileName.length >= maxLen - 4) return `.../${fileName}`;
	let result = fileName;
	for (let i = parts.length - 1; i >= 0; i--) {
		const candidate = `${parts[i]}/${result}`;
		if (candidate.length + 4 > maxLen) break;
		result = candidate;
	}
	return `.../${result}`;
}
