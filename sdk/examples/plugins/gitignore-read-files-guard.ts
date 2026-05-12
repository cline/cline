/**
 * Gitignore Read Guard Plugin Example
 *
 * Blocks file-opening tool calls when any requested path is ignored by a
 * workspace .gitignore file.
 *
 * CLI usage:
 *   mkdir -p .cline/plugins
 *   cp examples/plugins/gitignore-read-files-guard.ts .cline/plugins/gitignore-read-files-guard.ts
 *   cline -i "Read the ignored .env file"
 */

import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentPlugin } from "@cline/core";

const FILE_ACCESS_TOOL_NAMES = new Set(["read_files", "editor", "apply_patch"]);

interface IgnoreMatch {
	path: string;
	source: string;
	line: string;
	pattern: string;
}

let workspaceRoot = process.cwd();

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function addPath(value: unknown, paths: string[]): void {
	if (typeof value === "string" && value.trim().length > 0) {
		paths.push(value);
		return;
	}

	const record = asRecord(value);
	if (typeof record?.path === "string" && record.path.trim().length > 0) {
		paths.push(record.path);
	}
}

function addPathList(value: unknown, paths: string[]): void {
	if (Array.isArray(value)) {
		for (const entry of value) {
			addPath(entry, paths);
		}
		return;
	}
	addPath(value, paths);
}

function extractStructuredPaths(input: unknown): string[] {
	const paths: string[] = [];
	addPath(input, paths);

	if (Array.isArray(input)) {
		addPathList(input, paths);
		return paths;
	}

	const record = asRecord(input);
	if (!record) {
		return paths;
	}

	addPathList(record.files, paths);
	addPathList(record.file_paths, paths);
	addPathList(record.paths, paths);
	return paths;
}

function getApplyPatchInput(input: unknown): string | undefined {
	if (typeof input === "string") {
		return input;
	}

	const record = asRecord(input);
	if (typeof record?.input === "string") {
		return record.input;
	}

	return undefined;
}

function extractApplyPatchPaths(input: unknown): string[] {
	const patch = getApplyPatchInput(input);
	if (!patch) {
		return [];
	}

	const paths: string[] = [];
	const pathHeaders = [
		"*** Add File: ",
		"*** Update File: ",
		"*** Delete File: ",
		"*** Move to: ",
	];

	for (const line of patch.split(/\r?\n/)) {
		for (const header of pathHeaders) {
			if (line.startsWith(header)) {
				const path = line.slice(header.length).trim();
				if (path.length > 0) {
					paths.push(path);
				}
				break;
			}
		}
	}

	return paths;
}

function extractRequestedPaths(toolName: string, input: unknown): string[] {
	if (toolName === "apply_patch") {
		return extractApplyPatchPaths(input);
	}

	return extractStructuredPaths(input);
}

function toWorkspaceRelativePath(path: string): string | undefined {
	const absolutePath = resolve(workspaceRoot, path);
	const relativePath = relative(workspaceRoot, absolutePath);
	if (
		relativePath.length === 0 ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath) ||
		resolve(workspaceRoot, relativePath) !== absolutePath
	) {
		return undefined;
	}
	return relativePath.split(sep).join("/");
}

function isWorkspaceGitignoreSource(source: string): boolean {
	const normalizedSource = source.split(sep).join("/");
	if (
		normalizedSource !== ".gitignore" &&
		!normalizedSource.endsWith("/.gitignore")
	) {
		return false;
	}

	const absoluteSource = resolve(workspaceRoot, source);
	const relativeSource = relative(workspaceRoot, absoluteSource);
	return (
		relativeSource === ".gitignore" ||
		(!relativeSource.startsWith(`..${sep}`) &&
			!isAbsolute(relativeSource) &&
			relativeSource.endsWith(`${sep}.gitignore`))
	);
}

function parseCheckIgnoreOutput(output: Buffer): IgnoreMatch[] {
	const fields = output.toString("utf8").split("\0");
	const matches: IgnoreMatch[] = [];

	for (let i = 0; i + 3 < fields.length; i += 4) {
		const source = fields[i] ?? "";
		const line = fields[i + 1] ?? "";
		const pattern = fields[i + 2] ?? "";
		const path = fields[i + 3] ?? "";
		if (!source || !pattern || pattern.startsWith("!")) {
			continue;
		}
		if (!line || !path) {
			continue;
		}
		if (!isWorkspaceGitignoreSource(source)) {
			continue;
		}
		matches.push({ source, line, pattern, path });
	}

	return matches;
}

async function checkIgnoredByWorkspaceGitignore(
	relativePaths: string[],
): Promise<IgnoreMatch[]> {
	if (relativePaths.length === 0) {
		return [];
	}

	return new Promise((resolveMatches) => {
		const child = spawn(
			"git",
			["check-ignore", "--stdin", "-z", "-v", "-n", "--no-index"],
			{ cwd: workspaceRoot, stdio: ["pipe", "pipe", "pipe"] },
		);

		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];

		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

		child.on("error", (error) => {
			console.warn(
				`[gitignore-read-guard] could not run git: ${error.message}`,
			);
			resolveMatches([]);
		});

		child.on("close", (code) => {
			if (code !== 0 && code !== 1) {
				const message = Buffer.concat(stderr).toString("utf8").trim();
				console.warn(
					`[gitignore-read-guard] git check-ignore failed${message ? `: ${message}` : ""}`,
				);
				resolveMatches([]);
				return;
			}

			resolveMatches(parseCheckIgnoreOutput(Buffer.concat(stdout)));
		});

		child.stdin.end(`${relativePaths.join("\0")}\0`);
	});
}

const plugin: AgentPlugin = {
	name: "gitignore-read-files-guard",
	manifest: {
		capabilities: ["hooks"],
	},

	setup(_api, ctx) {
		workspaceRoot = ctx.workspaceInfo?.rootPath ?? process.cwd();
	},

	hooks: {
		async beforeTool({ toolCall, input }) {
			if (!FILE_ACCESS_TOOL_NAMES.has(toolCall.toolName)) {
				return undefined;
			}

			const relativePaths = [
				...new Set(
					extractRequestedPaths(toolCall.toolName, input)
						.map(toWorkspaceRelativePath)
						.filter((path): path is string => Boolean(path)),
				),
			];
			const ignored = await checkIgnoredByWorkspaceGitignore(relativePaths);

			if (ignored.length === 0) {
				return undefined;
			}

			const blockedPaths = ignored.map((match) => match.path).join(", ");
			console.error(
				`[gitignore-read-guard] blocked ${toolCall.toolName}: ${blockedPaths}`,
			);
			return {
				skip: true,
				reason: `Blocked ${toolCall.toolName}: ${blockedPaths} matched workspace .gitignore`,
			};
		},
	},
};

export { plugin };
export default plugin;
