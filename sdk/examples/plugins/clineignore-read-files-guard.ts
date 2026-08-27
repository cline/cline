/**
 * .clineignore Read Guard Plugin Example
 *
 * Blocks file-opening tool calls when any requested path matches a
 * gitignore-style pattern listed in the workspace .clineignore file.
 *
 * List the files you want to keep away from the agent in a .clineignore
 * file at your workspace root using .gitignore syntax (directories, globs,
 * and ! negations all work). The workspace's own .gitignore files are never
 * consulted, and the workspace does not need to be a git repository — git
 * is used purely as a pattern matcher.
 *
 * CLI usage:
 *   cline plugin install https://github.com/cline/cline/blob/main/sdk/examples/plugins/clineignore-read-files-guard.ts --cwd .
 *   echo ".env" >> .clineignore
 *   cline -i "Read the .env file"
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentPlugin } from "@cline/core";

const FILE_ACCESS_TOOL_NAMES = new Set([
	"read_files",
	"editor",
	"apply_patch",
	"run_commands",
]);

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

function extractCommandStrings(input: unknown): string[] {
	if (typeof input === "string") {
		return [input];
	}

	if (Array.isArray(input)) {
		return input.flatMap(extractCommandStrings);
	}

	const record = asRecord(input);
	if (!record) {
		return [];
	}

	const commands: string[] = [];
	for (const value of [record.commands, record.command, record.cmd]) {
		if (typeof value === "string") {
			commands.push(value);
		} else if (Array.isArray(value)) {
			commands.push(...value.flatMap(extractCommandStrings));
		}
	}
	if (typeof record.command === "string" && Array.isArray(record.args)) {
		commands.push(...record.args.filter((arg) => typeof arg === "string"));
	}
	return commands;
}

/**
 * Conservative shell guard: treat every whitespace-separated token of every
 * command as a candidate path. This catches straightforward bypasses like
 * `cat .env` without attempting full shell parsing, at the cost of the odd
 * false positive when a command argument merely looks like an ignored path.
 */
function extractCommandTokens(input: unknown): string[] {
	return extractCommandStrings(input).flatMap((command) =>
		command
			.split(/[\s;|&()<>]+/)
			.map((token) => token.replace(/^["']+|["']+$/g, ""))
			.filter((token) => token.length > 0 && !token.startsWith("-")),
	);
}

function extractRequestedPaths(toolName: string, input: unknown): string[] {
	if (toolName === "apply_patch") {
		return extractApplyPatchPaths(input);
	}
	if (toolName === "run_commands") {
		return extractCommandTokens(input);
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

/**
 * Empty scratch git repository used as a pattern-matching sandbox. Running
 * `git check-ignore` here with core.excludesFile pointed at the workspace
 * .clineignore scopes the check to that file alone: the workspace's own
 * .gitignore files are never consulted, and no real repository is required.
 */
let scratchRepo: string | undefined;

async function getScratchRepo(): Promise<string | undefined> {
	if (scratchRepo) {
		return scratchRepo;
	}

	const dir = mkdtempSync(join(tmpdir(), "clineignore-guard-"));
	const initialized = await new Promise<boolean>((resolveInit) => {
		const child = spawn("git", ["init", "-q", dir], { windowsHide: true });
		child.on("error", () => resolveInit(false));
		child.on("close", (code) => resolveInit(code === 0));
	});

	if (!initialized) {
		console.warn("[clineignore-read-guard] could not initialize git sandbox");
		return undefined;
	}

	scratchRepo = dir;
	return scratchRepo;
}

async function checkIgnoredByClineignore(
	relativePaths: string[],
): Promise<string[]> {
	if (relativePaths.length === 0) {
		return [];
	}

	const ignoreFile = resolve(workspaceRoot, ".clineignore");
	if (!existsSync(ignoreFile)) {
		return [];
	}

	const sandbox = await getScratchRepo();
	if (!sandbox) {
		return [];
	}

	return new Promise((resolveMatches) => {
		const child = spawn(
			"git",
			[
				"-c",
				`core.excludesFile=${ignoreFile}`,
				"check-ignore",
				"--stdin",
				"-z",
				"--no-index",
			],
			{
				cwd: sandbox,
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			},
		);

		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];

		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

		child.on("error", (error) => {
			console.warn(
				`[clineignore-read-guard] could not run git: ${error.message}`,
			);
			resolveMatches([]);
		});

		// Exit code 0 means at least one path matched, 1 means none matched.
		child.on("close", (code) => {
			if (code !== 0 && code !== 1) {
				const message = Buffer.concat(stderr).toString("utf8").trim();
				console.warn(
					`[clineignore-read-guard] git check-ignore failed${message ? `: ${message}` : ""}`,
				);
				resolveMatches([]);
				return;
			}

			resolveMatches(
				Buffer.concat(stdout)
					.toString("utf8")
					.split("\0")
					.filter((path) => path.length > 0),
			);
		});

		child.stdin.end(`${relativePaths.join("\0")}\0`);
	});
}

const plugin: AgentPlugin = {
	name: "clineignore-read-files-guard",
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

			// The guard is only as strong as the ignore file itself: protect
			// .clineignore from modification so the agent cannot un-ignore
			// files (reading it stays allowed).
			if (
				toolCall.toolName !== "read_files" &&
				relativePaths.includes(".clineignore")
			) {
				console.error(
					`[clineignore-read-guard] blocked ${toolCall.toolName}: .clineignore`,
				);
				return {
					skip: true,
					reason: `Blocked ${toolCall.toolName}: modifying .clineignore is not allowed. Read it with read_files if needed, and ask the user to update it if a file needs to be un-ignored.`,
				};
			}

			const ignored = await checkIgnoredByClineignore(relativePaths);

			if (ignored.length === 0) {
				return undefined;
			}

			const blockedPaths = ignored.join(", ");
			console.error(
				`[clineignore-read-guard] blocked ${toolCall.toolName}: ${blockedPaths}`,
			);
			return {
				skip: true,
				reason: `Blocked ${toolCall.toolName}: ${blockedPaths} matched a .clineignore pattern. Do not try to access these files another way; ask the user if you need their contents.`,
			};
		},
	},
};

export { plugin };
export default plugin;
