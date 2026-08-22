import { execFile, spawn } from "node:child_process";
import { type Dir, constants as fsConstants } from "node:fs";
import { access, opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
	basename,
	delimiter,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import type { SidecarContext } from "./types";

type RecordValue = Record<string, unknown>;

export interface HostCommandContext
	extends Pick<SidecarContext, "workspaceRoot" | "workspaceRootLocked"> {
	readonly client: {
		getStatus(): Promise<{ dataDir: string }>;
	};
}

export type HostCommandResult =
	| { handled: false }
	| { handled: true; result: unknown };

type HostCommandDependencies = {
	platform: NodeJS.Platform;
	env: Record<string, string | undefined>;
	homeDir: string;
	launchDetached(command: string, args: readonly string[]): Promise<void>;
};

const MAX_PATH_CHARACTERS = 32_768;
const MAX_URL_CHARACTERS = 8_192;
const MAX_SEARCH_QUERY_CHARACTERS = 512;
const MAX_SEARCHED_ENTRIES = 100_000;
const OPENABLE_URL_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);
const SKIPPED_SEARCH_DIRECTORIES = new Set([
	".git",
	".next",
	".cache",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"target",
	"vendor",
]);

interface CodeEditorDefinition {
	readonly id: string;
	readonly label: string;
	readonly cli: string;
	readonly macApps: readonly string[];
}

const CODE_EDITOR_CATALOG: readonly CodeEditorDefinition[] = [
	{
		id: "vscode",
		label: "VS Code",
		cli: "code",
		macApps: ["Visual Studio Code"],
	},
	{ id: "cursor", label: "Cursor", cli: "cursor", macApps: ["Cursor"] },
	{
		id: "windsurf",
		label: "Windsurf",
		cli: "windsurf",
		macApps: ["Windsurf"],
	},
	{ id: "zed", label: "Zed", cli: "zed", macApps: ["Zed"] },
	{
		id: "vscode-insiders",
		label: "VS Code Insiders",
		cli: "code-insiders",
		macApps: ["Visual Studio Code - Insiders"],
	},
	{
		id: "sublime",
		label: "Sublime Text",
		cli: "subl",
		macApps: ["Sublime Text"],
	},
	{
		id: "intellijidea",
		label: "IntelliJ IDEA",
		cli: "idea",
		macApps: ["IntelliJ IDEA", "IntelliJ IDEA CE"],
	},
	{ id: "xcode", label: "Xcode", cli: "xed", macApps: ["Xcode"] },
];

function defaultLaunchDetached(
	command: string,
	args: readonly string[],
): Promise<void> {
	return new Promise((resolveLaunch, rejectLaunch) => {
		const child = spawn(command, [...args], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		});
		child.once("spawn", () => {
			child.unref();
			resolveLaunch();
		});
		child.once("error", (error) => {
			rejectLaunch(
				new Error(`Could not launch ${command}: ${error.message}`, {
					cause: error,
				}),
			);
		});
	});
}

function textArgument(value: unknown, label: string, maximum: number): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} is required`);
	}
	const trimmed = value.trim();
	if (trimmed.length > maximum || /[\0\r\n]/.test(trimmed)) {
		throw new Error(`${label} is invalid`);
	}
	return trimmed;
}

function expandHome(path: string, homeDir: string): string {
	if (path === "~") return homeDir;
	if (path.startsWith(`~${sep}`) || path.startsWith("~/")) {
		return join(homeDir, path.slice(2));
	}
	if (path.startsWith("~")) {
		throw new Error("Named home-directory shortcuts are not supported");
	}
	return path;
}

function isWithin(root: string, candidate: string): boolean {
	const child = relative(root, candidate);
	return (
		child === "" ||
		(!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))
	);
}

async function canonicalDirectory(
	path: string,
	label: string,
): Promise<string> {
	let canonical: string;
	try {
		canonical = await realpath(path);
	} catch {
		throw new Error(`${label} does not exist`);
	}
	const details = await stat(canonical);
	if (!details.isDirectory()) throw new Error(`${label} is not a directory`);
	return canonical;
}

async function canonicalFile(path: string, label: string): Promise<string> {
	let canonical: string;
	try {
		canonical = await realpath(path);
	} catch {
		throw new Error(`${label} does not exist`);
	}
	const details = await stat(canonical);
	if (!details.isFile()) throw new Error(`${label} is not a file`);
	return canonical;
}

function execFileText(
	command: string,
	args: readonly string[],
	cwd: string,
): Promise<string> {
	return new Promise((resolveOutput, rejectOutput) => {
		execFile(
			command,
			[...args],
			{
				cwd,
				encoding: "utf8",
				maxBuffer: 2 * 1024 * 1024,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					const detail = String(stderr).trim();
					rejectOutput(
						new Error(detail || error.message, {
							cause: error,
						}),
					);
					return;
				}
				resolveOutput(String(stdout));
			},
		);
	});
}

function searchRank(path: string, query: string): number {
	if (!query) return 3;
	const lower = path.toLowerCase();
	if (lower.startsWith(query)) return 0;
	if (lower.includes(`/${query}`)) return 1;
	if (basename(lower).startsWith(query)) return 2;
	if (lower.includes(query)) return 3;
	return Number.POSITIVE_INFINITY;
}

async function searchFiles(
	root: string,
	query: string,
	limit: number,
): Promise<string[]> {
	const candidates: Array<{ path: string; rank: number }> = [];
	const directories = [root];
	let visited = 0;
	while (directories.length > 0 && visited < MAX_SEARCHED_ENTRIES) {
		const directory = directories.pop();
		if (!directory) break;
		let entries: Dir;
		try {
			entries = await opendir(directory);
		} catch {
			continue;
		}
		for await (const entry of entries) {
			visited += 1;
			if (visited > MAX_SEARCHED_ENTRIES) break;
			if (entry.isSymbolicLink()) continue;
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!SKIPPED_SEARCH_DIRECTORIES.has(entry.name.toLowerCase())) {
					directories.push(absolute);
				}
				continue;
			}
			if (!entry.isFile()) continue;
			const path = relative(root, absolute).split(sep).join("/");
			const rank = searchRank(path, query);
			if (Number.isFinite(rank)) candidates.push({ path, rank });
		}
	}
	return candidates
		.sort((left, right) =>
			left.rank === right.rank
				? left.path.localeCompare(right.path)
				: left.rank - right.rank,
		)
		.slice(0, limit)
		.map(({ path }) => path);
}

async function isExecutable(path: string, platform: NodeJS.Platform) {
	try {
		const details = await stat(path);
		if (!details.isFile()) return false;
		if (platform !== "win32") await access(path, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

async function findExecutable(
	name: string,
	dependencies: HostCommandDependencies,
): Promise<string | undefined> {
	const pathValue = dependencies.env.PATH ?? dependencies.env.Path ?? "";
	const names =
		dependencies.platform === "win32" ? [`${name}.exe`, name] : [name];
	for (const directory of pathValue.split(delimiter).filter(Boolean)) {
		for (const candidateName of names) {
			const candidate = join(directory, candidateName);
			if (await isExecutable(candidate, dependencies.platform)) {
				return realpath(candidate);
			}
		}
	}
	return undefined;
}

async function installedMacApp(
	apps: readonly string[],
	homeDir: string,
): Promise<string | undefined> {
	for (const app of apps) {
		for (const root of ["/Applications", join(homeDir, "Applications")]) {
			try {
				if ((await stat(join(root, `${app}.app`))).isDirectory()) return app;
			} catch {
				// Try the next well-known application directory.
			}
		}
	}
	return undefined;
}

function defaultOpener(platform: NodeJS.Platform): string {
	if (platform === "darwin") return "open";
	if (platform === "win32") return "explorer.exe";
	return "xdg-open";
}

function normalizeUrl(value: unknown): string {
	const raw = textArgument(value, "url", MAX_URL_CHARACTERS);
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error("url is invalid");
	}
	if (!OPENABLE_URL_PROTOCOLS.has(parsed.protocol)) {
		throw new Error("Only http(s), mailto, and tel URLs can be opened");
	}
	if (
		(parsed.protocol === "http:" || parsed.protocol === "https:") &&
		(!parsed.hostname || parsed.username || parsed.password)
	) {
		throw new Error(
			"HTTP URLs must name a host and cannot contain credentials",
		);
	}
	return parsed.toString();
}

/**
 * Host-only desktop commands. Durable agent state deliberately stays in the
 * Gateway; this module owns narrowly scoped filesystem and OS integration.
 */
export function createHostCommandHandler(
	overrides: Partial<HostCommandDependencies> = {},
): (
	ctx: HostCommandContext,
	command: string,
	args?: RecordValue,
) => Promise<HostCommandResult> {
	const dependencies: HostCommandDependencies = {
		platform: process.platform,
		env: process.env,
		homeDir: homedir(),
		launchDetached: defaultLaunchDetached,
		...overrides,
	};
	const approvedRoots = new WeakMap<HostCommandContext, Set<string>>();
	let editorCache:
		| {
				editors: Array<{ id: string; label: string }>;
				executables: Map<string, string>;
				macApps: Map<string, string>;
		  }
		| undefined;

	const rootsFor = async (ctx: HostCommandContext): Promise<Set<string>> => {
		let roots = approvedRoots.get(ctx);
		if (!roots) {
			roots = new Set([
				await canonicalDirectory(
					resolve(ctx.workspaceRoot),
					"Configured workspace",
				),
			]);
			approvedRoots.set(ctx, roots);
		}
		return roots;
	};

	const resolveApprovedWorkspace = async (
		ctx: HostCommandContext,
		value: unknown,
	): Promise<string> => {
		const raw =
			value === undefined
				? ctx.workspaceRoot
				: textArgument(value, "workspace path", MAX_PATH_CHARACTERS);
		const expanded = expandHome(raw, dependencies.homeDir);
		const candidate = await canonicalDirectory(
			isAbsolute(expanded) ? expanded : resolve(ctx.workspaceRoot, expanded),
			"Workspace path",
		);
		const roots = await rootsFor(ctx);
		if (![...roots].some((root) => isWithin(root, candidate))) {
			throw new Error(
				"Workspace path has not been approved by this desktop session",
			);
		}
		return candidate;
	};

	const validateWorkspace = async (
		ctx: HostCommandContext,
		value: unknown,
	): Promise<{ valid: boolean; path?: string }> => {
		try {
			const raw = textArgument(value, "workspace path", MAX_PATH_CHARACTERS);
			const expanded = expandHome(raw, dependencies.homeDir);
			const candidate = await canonicalDirectory(
				isAbsolute(expanded) ? expanded : resolve(ctx.workspaceRoot, expanded),
				"Workspace path",
			);
			const roots = await rootsFor(ctx);
			if (
				ctx.workspaceRootLocked &&
				![...roots].some((root) => isWithin(root, candidate))
			) {
				return { valid: false };
			}
			if (!ctx.workspaceRootLocked) roots.add(candidate);
			return { valid: true, path: candidate };
		} catch {
			return { valid: false };
		}
	};

	const gitBranches = async (cwd: string) => {
		const [current, branches] = await Promise.all([
			execFileText("git", ["branch", "--show-current"], cwd).catch(() => ""),
			execFileText(
				"git",
				["for-each-ref", "--format=%(refname:short)", "refs/heads"],
				cwd,
			).catch(() => ""),
		]);
		return {
			current: current.trim() || undefined,
			branches: branches
				.split("\n")
				.map((branch) => branch.trim())
				.filter(Boolean),
		};
	};

	const availableEditors = async () => {
		if (editorCache) return editorCache;
		const editors: Array<{ id: string; label: string }> = [];
		const executables = new Map<string, string>();
		const macApps = new Map<string, string>();
		for (const editor of CODE_EDITOR_CATALOG) {
			const executable = await findExecutable(editor.cli, dependencies);
			const macApp =
				dependencies.platform === "darwin"
					? await installedMacApp(editor.macApps, dependencies.homeDir)
					: undefined;
			if (!executable && !macApp) continue;
			editors.push({ id: editor.id, label: editor.label });
			if (executable) executables.set(editor.id, executable);
			if (macApp) macApps.set(editor.id, macApp);
		}
		editorCache = { editors, executables, macApps };
		return editorCache;
	};

	const openMcpSettingsFile = async (
		ctx: HostCommandContext,
		pathInput: unknown,
	): Promise<string> => {
		const { dataDir } = await ctx.client.getStatus();
		const canonicalDataDir = await canonicalDirectory(
			dataDir,
			"Gateway data directory",
		);
		const expectedPath = resolve(dataDir, "mcp-settings.json");
		const requestedPath =
			pathInput === undefined
				? expectedPath
				: resolve(
						textArgument(pathInput, "MCP settings path", MAX_PATH_CHARACTERS),
					);
		if (requestedPath !== expectedPath) {
			throw new Error(
				"MCP settings path must be the active Gateway-owned settings file",
			);
		}
		const filePath = await canonicalFile(expectedPath, "MCP settings file");
		if (!isWithin(canonicalDataDir, filePath)) {
			throw new Error("MCP settings file escapes the Gateway data directory");
		}
		await dependencies.launchDetached(defaultOpener(dependencies.platform), [
			filePath,
		]);
		return filePath;
	};

	return async (ctx, command, args = {}) => {
		if (command === "validate_workspace_directory") {
			return { handled: true, result: await validateWorkspace(ctx, args.path) };
		}
		if (command === "get_git_branch" || command === "list_git_branches") {
			const cwd = await resolveApprovedWorkspace(ctx, args.cwd);
			const branches = await gitBranches(cwd);
			return {
				handled: true,
				result:
					command === "get_git_branch"
						? { branch: branches.current }
						: branches,
			};
		}
		if (command === "checkout_git_branch") {
			const cwd = await resolveApprovedWorkspace(ctx, args.cwd);
			const branch = textArgument(args.branch, "branch", 1_024);
			const branches = await gitBranches(cwd);
			if (!branches.branches.includes(branch)) {
				throw new Error(`Unknown local Git branch: ${branch}`);
			}
			await execFileText("git", ["checkout", "--quiet", branch], cwd);
			return { handled: true, result: { branch } };
		}
		if (command === "search_workspace_files") {
			const root = await resolveApprovedWorkspace(ctx, args.workspaceRoot);
			const rawQuery = typeof args.query === "string" ? args.query.trim() : "";
			if (
				rawQuery.length > MAX_SEARCH_QUERY_CHARACTERS ||
				/[\0\r\n]/.test(rawQuery)
			) {
				throw new Error("search query is invalid");
			}
			const limit =
				typeof args.limit === "number" && Number.isFinite(args.limit)
					? Math.max(1, Math.min(50, Math.trunc(args.limit)))
					: 10;
			return {
				handled: true,
				result: await searchFiles(root, rawQuery.toLowerCase(), limit),
			};
		}
		if (command === "list_available_editors") {
			return { handled: true, result: (await availableEditors()).editors };
		}
		if (command === "open_file_in_editor") {
			const cwd = await resolveApprovedWorkspace(ctx, args.cwd);
			const rawPath = textArgument(args.path, "file path", MAX_PATH_CHARACTERS);
			const expanded = expandHome(rawPath, dependencies.homeDir);
			const filePath = await canonicalFile(
				isAbsolute(expanded) ? expanded : resolve(cwd, expanded),
				"File path",
			);
			if (!isWithin(cwd, filePath)) {
				throw new Error("File path escapes the selected workspace");
			}
			const editorId =
				typeof args.editor === "string" && args.editor.trim()
					? args.editor.trim()
					: "default";
			if (editorId === "default") {
				await dependencies.launchDetached(
					defaultOpener(dependencies.platform),
					[filePath],
				);
				return { handled: true, result: "system default" };
			}
			const editor = CODE_EDITOR_CATALOG.find(({ id }) => id === editorId);
			if (!editor) throw new Error(`Unknown editor: ${editorId}`);
			const available = await availableEditors();
			const executable = available.executables.get(editorId);
			if (executable) {
				await dependencies.launchDetached(executable, [filePath]);
				return { handled: true, result: editor.label };
			}
			const macApp = available.macApps.get(editorId);
			if (macApp) {
				await dependencies.launchDetached("open", ["-a", macApp, filePath]);
				return { handled: true, result: editor.label };
			}
			throw new Error(`${editor.label} is not available on this machine`);
		}
		if (command === "open_external_url") {
			const url = normalizeUrl(args.url);
			await dependencies.launchDetached(defaultOpener(dependencies.platform), [
				url,
			]);
			return { handled: true, result: { opened: true } };
		}
		if (command === "open_mcp_settings_file") {
			// The Gateway owns MCP configuration. The host only opens the existing,
			// deterministic settings path and never creates or mutates config data.
			return {
				handled: true,
				result: await openMcpSettingsFile(ctx, args.path),
			};
		}
		if (
			command === "pick_workspace_directory" ||
			command === "pick_bot_icon_file"
		) {
			// Browser-only development has no native picker. Returning cancellation
			// lets the existing UI expose its manual-path fallback without treating
			// the absence of Tauri as a backend failure.
			return { handled: true, result: null };
		}
		return { handled: false };
	};
}

export const handleHostCommand = createHostCommandHandler();
