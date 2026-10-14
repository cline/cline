import { execFile } from "node:child_process";
import { setHubDaemonLauncher } from "@cline/core";

/** Absolute path of the Cline CLI binary the desktop shell bundles and launched us with. */
export const DESKTOP_CLI_PATH_ENV = "CLINE_DESKTOP_CLI_PATH";
/** Workspace root the shell resolved; the backend starts in its own resource directory. */
export const DESKTOP_WORKSPACE_ROOT_ENV = "CLINE_DESKTOP_WORKSPACE_ROOT";
/** Makes a compiled Bun executable run a script instead of its embedded entrypoint. */
export const BUN_BE_BUN_ENV = "BUN_BE_BUN";

export function resolveDesktopCliPath(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	return env[DESKTOP_CLI_PATH_ENV]?.trim() || undefined;
}

/**
 * The packaged backend is a script running on the bundled Cline CLI's embedded
 * runtime. Adopt that host before anything spawns: every child (the Hub
 * daemon, connectors, agent tools) must see the CLI binary as the CLI, not as
 * a script runner, and Hubs this process starts must be CLI-managed Hubs.
 */
export function adoptDesktopCliRuntime(
	options: {
		env?: NodeJS.ProcessEnv;
		chdir?: (directory: string) => void;
		setLauncher?: typeof setHubDaemonLauncher;
	} = {},
): { cliPath?: string } {
	const env = options.env ?? process.env;
	const chdir = options.chdir ?? ((directory) => process.chdir(directory));
	const setLauncher = options.setLauncher ?? setHubDaemonLauncher;
	delete env[BUN_BE_BUN_ENV];
	// The shell starts the runtime outside the workspace so it cannot pick up a
	// workspace .env or bunfig.toml; workspace-relative code expects that cwd.
	const workspaceRoot = env[DESKTOP_WORKSPACE_ROOT_ENV]?.trim();
	delete env[DESKTOP_WORKSPACE_ROOT_ENV];
	if (workspaceRoot) {
		chdir(workspaceRoot);
	}
	const cliPath = resolveDesktopCliPath(env);
	if (cliPath) {
		setLauncher({ command: cliPath });
	}
	return { cliPath };
}

const HUB_ENSURE_TIMEOUT_MS = 60_000;

export type RunCliCommand = (
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<string>;

const runCliCommand: RunCliCommand = (command, args, options) =>
	new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{
				cwd: options.cwd,
				env: options.env,
				timeout: options.timeoutMs,
				windowsHide: true,
				maxBuffer: 1024 * 1024,
			},
			(error, stdout, stderr) => {
				if (error) {
					const detail = String(stderr).trim();
					reject(
						new Error(detail ? `${error.message}: ${detail}` : error.message),
					);
					return;
				}
				resolve(String(stdout));
			},
		);
	});

/**
 * Has the bundled CLI start the shared Hub, or reuse a compatible healthy
 * one, before the session manager connects. Returns the Hub URL (never the
 * auth token, which callers may log).
 */
export async function ensureHubWithDesktopCli(
	cliPath: string,
	workspaceRoot: string,
	options: { env?: NodeJS.ProcessEnv; run?: RunCliCommand } = {},
): Promise<{ url: string }> {
	const run = options.run ?? runCliCommand;
	const stdout = await run(
		cliPath,
		["hub", "ensure", "--json", "--cwd", workspaceRoot],
		{
			cwd: workspaceRoot,
			env: { ...(options.env ?? process.env), CLINE_NO_AUTO_UPDATE: "1" },
			timeoutMs: HUB_ENSURE_TIMEOUT_MS,
		},
	);
	const line = stdout
		.split(/\r?\n/)
		.map((value) => value.trim())
		.filter((value) => value.startsWith("{"))
		.at(-1);
	const parsed = line ? (JSON.parse(line) as { url?: unknown }) : undefined;
	if (typeof parsed?.url !== "string" || !parsed.url) {
		throw new Error("cline hub ensure did not report a Hub URL");
	}
	return { url: parsed.url };
}
