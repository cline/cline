import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

/**
 * Environment facts recorded for a tool call and attached to its tool result
 * message as `metadata.toolEnvironment`. Readers that do not know the key
 * ignore it.
 */
export interface ToolEnvironmentFileFact {
	path: string;
	exists: boolean;
	sha256?: string;
	bytes?: number;
	/** Set when the file was larger than the hashing cap; only `bytes` is recorded. */
	skipped?: "too-large" | "not-a-file" | "unreadable";
}

export interface ToolEnvironmentCommandFact {
	command: string;
	/** Derived from the tool result: 0 on success, the reported code otherwise. */
	exitCode: number | null;
	signal?: string;
	/** The command could not be started or timed out; no exit code exists. */
	failed?: string;
}

export interface ToolEnvironmentFacts {
	version: 1;
	/** read_files: content of each file as it was on disk when read. */
	read?: ToolEnvironmentFileFact[];
	/** editor/apply_patch: each target file before the tool ran. */
	preImage?: ToolEnvironmentFileFact[];
	/** editor/apply_patch: each target file after the tool ran. */
	postImage?: ToolEnvironmentFileFact[];
	/** run_commands: where and with which environment the commands ran. */
	commands?: {
		cwd: string;
		/** Hash of the allowlisted env recorded in the session's recording header. */
		envSha256: string;
		results: ToolEnvironmentCommandFact[];
	};
}

export const TOOL_ENVIRONMENT_METADATA_KEY = "toolEnvironment";

/** Files larger than this are recorded by size only. */
export const TOOL_ENVIRONMENT_MAX_HASH_BYTES = 16 * 1024 * 1024;

/**
 * Environment variables recorded for command tools. Deliberately an
 * allowlist: everything else in the host environment may hold credentials.
 */
export const RECORDED_ENV_ALLOWLIST = [
	"PATH",
	"SHELL",
	"HOME",
	"USER",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"TZ",
	"TMPDIR",
	"NODE_ENV",
	"CI",
] as const;

export function collectRecordedEnv(
	env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of RECORDED_ENV_ALLOWLIST) {
		const value = env[key];
		if (typeof value === "string") {
			out[key] = value;
		}
	}
	return out;
}

export type ToolEnvironmentKind = "read" | "edit" | "patch" | "command";

export function classifyToolEnvironment(
	toolName: string,
): ToolEnvironmentKind | undefined {
	switch (toolName) {
		case "read_files":
			return "read";
		case "editor":
			return "edit";
		case "apply_patch":
			return "patch";
		case "run_commands":
			return "command";
		default:
			return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

const READ_PATH_KEYS = new Set([
	"path",
	"file_path",
	"filePath",
	"files",
	"file_paths",
	"paths",
]);

/** Paths named by a read_files input, across the aliases the tool accepts. */
export function readFilesInputPaths(input: unknown): string[] {
	const paths: string[] = [];
	const visit = (value: unknown, underPathKey: boolean): void => {
		if (typeof value === "string") {
			if (underPathKey && value.trim()) {
				paths.push(value.trim());
			}
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				visit(item, underPathKey);
			}
			return;
		}
		if (isRecord(value)) {
			for (const [key, nested] of Object.entries(value)) {
				visit(nested, READ_PATH_KEYS.has(key));
			}
		}
	};
	visit(input, false);
	return [...new Set(paths)];
}

const PATCH_FILE_LINE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/;
const PATCH_MOVE_LINE = /^\*\*\* Move to: (.+)$/;

/** Files an apply_patch payload touches, including move targets. */
export function applyPatchInputPaths(input: unknown): string[] {
	const patch =
		typeof input === "string"
			? input
			: isRecord(input) && typeof input.input === "string"
				? input.input
				: "";
	const paths: string[] = [];
	for (const line of patch.split(/\r?\n/)) {
		const match = PATCH_FILE_LINE.exec(line) ?? PATCH_MOVE_LINE.exec(line);
		if (match?.[1]?.trim()) {
			paths.push(match[1].trim());
		}
	}
	return [...new Set(paths)];
}

export function editorInputPaths(input: unknown): string[] {
	return isRecord(input) && typeof input.path === "string" && input.path.trim()
		? [input.path.trim()]
		: [];
}

export function toolEnvironmentTargetPaths(
	kind: ToolEnvironmentKind,
	input: unknown,
	cwd: string,
): string[] {
	const raw =
		kind === "read"
			? readFilesInputPaths(input)
			: kind === "edit"
				? editorInputPaths(input)
				: kind === "patch"
					? applyPatchInputPaths(input)
					: [];
	return raw.map((path) => (isAbsolute(path) ? path : resolve(cwd, path)));
}

async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256");
	await new Promise<void>((resolvePromise, reject) => {
		const stream = createReadStream(path);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolvePromise());
	});
	return hash.digest("hex");
}

export async function hashFileFact(
	path: string,
	maxBytes = TOOL_ENVIRONMENT_MAX_HASH_BYTES,
): Promise<ToolEnvironmentFileFact> {
	let size: number;
	try {
		const info = await stat(path);
		if (!info.isFile()) {
			return { path, exists: true, skipped: "not-a-file" };
		}
		size = info.size;
	} catch (error) {
		const code = (error as { code?: unknown }).code;
		return code === "ENOENT" || code === "ENOTDIR"
			? { path, exists: false }
			: { path, exists: true, skipped: "unreadable" };
	}
	if (size > maxBytes) {
		return { path, exists: true, bytes: size, skipped: "too-large" };
	}
	try {
		return { path, exists: true, bytes: size, sha256: await sha256File(path) };
	} catch {
		return { path, exists: true, bytes: size, skipped: "unreadable" };
	}
}

export async function hashFileFacts(
	paths: readonly string[],
): Promise<ToolEnvironmentFileFact[]> {
	return Promise.all(paths.map((path) => hashFileFact(path)));
}

const EXIT_CODE_PATTERN = /exited with code (-?\d+)/;
const SIGNAL_PATTERN = /terminated by signal (\w+)/;

/** Per-command exit facts derived from a run_commands result. */
export function commandResultFacts(
	output: unknown,
): ToolEnvironmentCommandFact[] {
	if (!Array.isArray(output)) {
		return [];
	}
	return output.filter(isRecord).map((entry) => {
		const command = typeof entry.query === "string" ? entry.query : "";
		if (entry.success === true) {
			return { command, exitCode: 0 };
		}
		const error = typeof entry.error === "string" ? entry.error : "";
		const code = EXIT_CODE_PATTERN.exec(error)?.[1];
		if (code !== undefined) {
			return { command, exitCode: Number.parseInt(code, 10) };
		}
		const signal = SIGNAL_PATTERN.exec(error)?.[1];
		if (signal) {
			return { command, exitCode: null, signal };
		}
		return { command, exitCode: null, failed: error || "unknown" };
	});
}
