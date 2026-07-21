/**
 * Login-shell PATH resolution for the desktop sidecar.
 *
 * When the Tauri app is launched from Finder/the Dock on macOS, it inherits
 * launchd's minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) instead of the
 * user's shell PATH. The sidecar — and every process it spawns for the agent
 * (bash tool, MCP servers) — then can't find tools like `gh` that live in
 * /opt/homebrew/bin or other shell-profile-added directories, even though
 * the same task works from the CLI in a terminal.
 *
 * At startup we ask the user's login shell for its PATH and merge it into
 * process.env.PATH, so child processes see the same PATH a terminal would.
 */

import { spawn } from "node:child_process";
import { delimiter } from "node:path";

const PATH_MARKER_START = "__CLINE_SIDECAR_PATH_START__";
const PATH_MARKER_END = "__CLINE_SIDECAR_PATH_END__";
const SHELL_TIMEOUT_MS = 5_000;

/**
 * Escape hatch: set CLINE_SIDECAR_SKIP_SHELL_PATH=1 to leave PATH untouched
 * (e.g. if a broken shell profile makes resolution misbehave).
 */
const SKIP_ENV_VAR = "CLINE_SIDECAR_SKIP_SHELL_PATH";

export function defaultShellFor(platform: NodeJS.Platform): string {
	return platform === "darwin" ? "/bin/zsh" : "/bin/bash";
}

/**
 * Extract the PATH value printed between the sentinel markers, ignoring any
 * noise a shell profile writes to stdout around it.
 */
export function extractMarkedPath(output: string): string | undefined {
	const start = output.indexOf(PATH_MARKER_START);
	if (start === -1) {
		return undefined;
	}
	const end = output.indexOf(PATH_MARKER_END, start);
	if (end === -1) {
		return undefined;
	}
	const value = output.slice(start + PATH_MARKER_START.length, end).trim();
	return value.length > 0 ? value : undefined;
}

/**
 * Merge the login shell's PATH with the current one: shell entries first (so
 * profile-managed dirs like /opt/homebrew/bin win), then any current entries
 * the shell PATH doesn't already contain (so explicitly-injected dirs from
 * the launching environment aren't lost). Duplicates are dropped.
 */
export function mergePaths(shellPath: string, currentPath: string): string {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const entry of [
		...shellPath.split(delimiter),
		...currentPath.split(delimiter),
	]) {
		const trimmed = entry.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		merged.push(trimmed);
	}
	return merged.join(delimiter);
}

/**
 * Run the user's shell as a login+interactive shell and capture its PATH.
 * Resolves to undefined on any failure (missing shell, timeout, profile
 * error) — callers should treat that as "keep the current PATH".
 */
export function resolveLoginShellPath(
	shell: string,
	timeoutMs = SHELL_TIMEOUT_MS,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		// -l sources login profiles (~/.zprofile, where Homebrew installs its
		// shellenv hook); -i sources interactive rc files (~/.zshrc, where
		// version managers like nvm typically live). The markers isolate the
		// PATH value from anything those profiles print.
		const child = spawn(
			shell,
			[
				"-ilc",
				`printf '%s%s%s' '${PATH_MARKER_START}' "$PATH" '${PATH_MARKER_END}'`,
			],
			{ stdio: ["ignore", "pipe", "ignore"], detached: true },
		);

		let output = "";
		let settled = false;
		const settle = (value: string | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			resolve(value);
		};

		const timeout = setTimeout(() => {
			try {
				if (child.pid) {
					process.kill(-child.pid, "SIGKILL");
				}
			} catch {
				child.kill("SIGKILL");
			}
			settle(undefined);
		}, timeoutMs);

		child.stdout?.on("data", (data: Buffer) => {
			output += data.toString("utf8");
		});
		child.on("error", () => settle(undefined));
		child.on("close", () => settle(extractMarkedPath(output)));
	});
}

/**
 * Resolve the login shell's PATH and merge it into process.env.PATH.
 * No-op on Windows (the GUI PATH comes from the registry there) and when
 * CLINE_SIDECAR_SKIP_SHELL_PATH is set. Failures are reported via the
 * returned status but never block startup.
 */
export async function ensureLoginShellPath(options?: {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}): Promise<
	| { status: "applied"; path: string; shell: string }
	| { status: "skipped"; reason: string }
	| { status: "failed"; shell: string }
> {
	const platform = options?.platform ?? process.platform;
	const env = options?.env ?? process.env;

	if (platform === "win32") {
		return { status: "skipped", reason: "windows" };
	}
	if (env[SKIP_ENV_VAR]?.trim()) {
		return { status: "skipped", reason: SKIP_ENV_VAR };
	}

	const shell = env.SHELL?.trim() || defaultShellFor(platform);
	const shellPath = await resolveLoginShellPath(shell, options?.timeoutMs);
	if (!shellPath) {
		return { status: "failed", shell };
	}

	const merged = mergePaths(shellPath, env.PATH ?? "");
	env.PATH = merged;
	return { status: "applied", path: merged, shell };
}
