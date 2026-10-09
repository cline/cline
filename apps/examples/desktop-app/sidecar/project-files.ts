import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { isAbsolute, join, posix, relative } from "node:path";
import type { RemoteEnvironmentService } from "@cline/core";
import type { SessionRuntimeBinding, SidecarContext } from "./types";

// Project explorer backing for the desktop app: one directory level per
// request so a monorepo never needs a full index, and bounded file reads so
// a stray binary or generated bundle cannot stall the webview.

export const PROJECT_ENTRY_LIMIT = 1_000;
export const PROJECT_FILE_READ_LIMIT_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
const HIDDEN_ENTRIES = new Set([".git"]);

export type ProjectEntry = {
	name: string;
	path: string;
	kind: "file" | "directory";
};

export type ProjectEntriesResult = {
	environmentId: string;
	path: string;
	entries: ProjectEntry[];
	truncated: boolean;
};

export type ProjectFileResult = {
	environmentId: string;
	path: string;
	/** Null for binary files. */
	content: string | null;
	truncated: boolean;
};

export type GitStatusResult = {
	environmentId: string;
	/** Absolute repository root, or null when `cwd` is not inside a repo. */
	root: string | null;
	/** Repo-root-relative paths mapped to a porcelain status code (M, A, D, ?, R). */
	entries: Record<string, string>;
};

function sortEntries(entries: ProjectEntry[]): ProjectEntry[] {
	return entries.sort((left, right) =>
		left.kind !== right.kind
			? left.kind === "directory"
				? -1
				: 1
			: left.name.localeCompare(right.name),
	);
}

// Keeps the explorer coherent: every listed or read path sits under the root
// the tree was opened with. Symlinks are followed on purpose (bun's
// node_modules/.bun layout, links to sibling checkouts); this is the user's
// own filesystem shown back to them, not a sandbox.
function assertInsideRoot(root: string, path: string, isPosix: boolean): void {
	const rel = isPosix ? posix.relative(root, path) : relative(root, path);
	if (
		rel === ".." ||
		rel.startsWith("../") ||
		rel.startsWith("..\\") ||
		(isPosix ? posix.isAbsolute(rel) : isAbsolute(rel))
	) {
		throw new Error("Path is outside the workspace");
	}
}

function looksBinary(buffer: Buffer): boolean {
	return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

export function listLocalProjectEntries(
	root: string,
	path: string,
): Omit<ProjectEntriesResult, "environmentId"> {
	assertInsideRoot(root, path, false);
	if (!statSync(path).isDirectory()) {
		throw new Error(`Not a directory: ${path}`);
	}
	const entries: ProjectEntry[] = [];
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		if (HIDDEN_ENTRIES.has(entry.name)) continue;
		let kind: ProjectEntry["kind"] | null = entry.isDirectory()
			? "directory"
			: entry.isFile()
				? "file"
				: null;
		if (kind === null && entry.isSymbolicLink()) {
			try {
				kind = statSync(join(path, entry.name)).isDirectory()
					? "directory"
					: "file";
			} catch {
				continue;
			}
		}
		if (kind)
			entries.push({ name: entry.name, path: join(path, entry.name), kind });
	}
	sortEntries(entries);
	return {
		path,
		entries: entries.slice(0, PROJECT_ENTRY_LIMIT),
		truncated: entries.length > PROJECT_ENTRY_LIMIT,
	};
}

export function readLocalProjectFile(
	root: string,
	path: string,
): Omit<ProjectFileResult, "environmentId"> {
	assertInsideRoot(root, path, false);
	const stat = statSync(path);
	if (!stat.isFile()) throw new Error(`Not a file: ${path}`);
	const buffer = Buffer.alloc(
		Math.min(stat.size, PROJECT_FILE_READ_LIMIT_BYTES),
	);
	const fd = openSync(path, "r");
	try {
		readSync(fd, buffer, 0, buffer.length, 0);
	} finally {
		closeSync(fd);
	}
	if (looksBinary(buffer)) return { path, content: null, truncated: false };
	return {
		path,
		content: buffer.toString("utf8"),
		truncated: stat.size > PROJECT_FILE_READ_LIMIT_BYTES,
	};
}

export function parseGitStatusPorcelain(
	output: string,
): Record<string, string> {
	const entries: Record<string, string> = {};
	// `-z` output: `XY path\0` records, renames add an `origin\0` record after.
	const records = output.split("\0");
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (record.length < 4) continue;
		const x = record[0];
		const y = record[1];
		const path = record.slice(3);
		const code =
			x === "?" ? "?" : x === "R" || y === "R" ? "R" : y !== " " ? y : x;
		entries[path] = code;
		if (code === "R") index++;
	}
	return entries;
}

// `ls -p` marks directories with a trailing slash; names themselves cannot
// contain `/`, so the marker is unambiguous. Newlines in names are not
// supported over SSH.
export function parseRemoteListing(
	path: string,
	output: string,
): Omit<ProjectEntriesResult, "environmentId"> {
	const entries: ProjectEntry[] = [];
	for (const raw of output.split("\n")) {
		if (!raw) continue;
		const isDir = raw.endsWith("/");
		const name = isDir ? raw.slice(0, -1) : raw;
		if (!name || HIDDEN_ENTRIES.has(name)) continue;
		entries.push({
			name,
			path: posix.join(path, name),
			kind: isDir ? "directory" : "file",
		});
	}
	sortEntries(entries);
	return {
		path,
		entries: entries.slice(0, PROJECT_ENTRY_LIMIT),
		truncated: entries.length > PROJECT_ENTRY_LIMIT,
	};
}

function requireRemote(ctx: SidecarContext): RemoteEnvironmentService {
	if (!ctx.remoteEnvironments) {
		throw new Error("Remote environment service is unavailable");
	}
	return ctx.remoteEnvironments;
}

export async function listProjectEntries(
	ctx: SidecarContext,
	binding: SessionRuntimeBinding,
	root: string,
	path: string,
): Promise<ProjectEntriesResult> {
	const environmentId = binding.environmentId;
	if (binding.kind === "local") {
		return { environmentId, ...listLocalProjectEntries(root, path) };
	}
	assertInsideRoot(root, path, true);
	const result = await requireRemote(ctx).run(environmentId, {
		command: "ls",
		args: ["-1Ap", "--", path],
	});
	return { environmentId, ...parseRemoteListing(path, result.stdout) };
}

export async function readProjectFile(
	ctx: SidecarContext,
	binding: SessionRuntimeBinding,
	root: string,
	path: string,
): Promise<ProjectFileResult> {
	const environmentId = binding.environmentId;
	if (binding.kind === "local") {
		return { environmentId, ...readLocalProjectFile(root, path) };
	}
	assertInsideRoot(root, path, true);
	const result = await requireRemote(ctx).run(environmentId, {
		command: "head",
		args: ["-c", String(PROJECT_FILE_READ_LIMIT_BYTES + 1), "--", path],
	});
	if (result.stdout.includes("\0")) {
		return { environmentId, path, content: null, truncated: false };
	}
	// `head` capped bytes, not characters: multibyte text decodes shorter.
	const bytes = Buffer.from(result.stdout, "utf8");
	const truncated = bytes.length > PROJECT_FILE_READ_LIMIT_BYTES;
	return {
		environmentId,
		path,
		content: truncated
			? bytes.subarray(0, PROJECT_FILE_READ_LIMIT_BYTES).toString("utf8")
			: result.stdout,
		truncated,
	};
}

export async function getGitStatus(
	runGit: (args: string[]) => Promise<string | undefined>,
	environmentId: string,
): Promise<GitStatusResult> {
	const root = (await runGit(["rev-parse", "--show-toplevel"]))?.trim();
	if (!root) return { environmentId, root: null, entries: {} };
	const output =
		(await runGit([
			"status",
			"--porcelain=v1",
			"-z",
			"--untracked-files=all",
		])) ?? "";
	return { environmentId, root, entries: parseGitStatusPorcelain(output) };
}
