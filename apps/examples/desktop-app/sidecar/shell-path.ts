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
import { userInfo } from "node:os";
import { basename, delimiter } from "node:path";

const PATH_MARKER_START = "__CLINE_SIDECAR_PATH_START__";
const PATH_MARKER_END = "__CLINE_SIDECAR_PATH_END__";

/**
 * Kept well under the Tauri shell's 5s endpoint-readiness poll: this
 * resolution overlaps sidecar startup but is awaited before the server
 * starts, so a pathological shell profile must not eat the whole window.
 */
const SHELL_TIMEOUT_MS = 2_000;

/**
 * The command every shell is asked to run. $PATH expansion happens inside
 * POSIX sh — not the user's shell — so shells with different expansion rules
 * (fish would space-join "$PATH") still produce a colon-delimited value; sh
 * reads the PATH environment variable the login shell exported.
 */
const PRINT_PATH_COMMAND = `/bin/sh -c 'printf "%s%s%s" "${PATH_MARKER_START}" "$PATH" "${PATH_MARKER_END}"'`;

/**
 * Escape hatch: set CLINE_SIDECAR_SKIP_SHELL_PATH=1 to leave PATH untouched
 * (e.g. if a broken shell profile makes resolution misbehave).
 */
const SKIP_ENV_VAR = "CLINE_SIDECAR_SKIP_SHELL_PATH";

export function defaultShellFor(platform: NodeJS.Platform): string {
	return platform === "darwin" ? "/bin/zsh" : "/bin/bash";
}

/**
 * The user's configured login shell. The account database is authoritative:
 * a GUI-launched process has no parent shell, so $SHELL may be unset there.
 * userInfo() reads getpwuid(), which on macOS goes through DirectoryServices
 * — the same source `dscl . -read /Users/$USER UserShell` reports — and on
 * Linux resolves via NSS (/etc/passwd et al.). $SHELL and the platform
 * default are fallbacks for environments with no passwd entry.
 */
export function loginShellFor(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): string {
	try {
		const shell = userInfo().shell?.trim();
		if (shell) {
			return shell;
		}
	} catch {
		// No passwd entry for the current uid (some containers) — fall through.
	}
	return env.SHELL?.trim() || defaultShellFor(platform);
}

export interface ShellInvocation {
	args: string[];
	/**
	 * argv[0] the shell should see. A leading dash is the historical "you
	 * are a login shell" signal, used where -l can't be passed as a flag.
	 */
	argv0?: string;
}

/**
 * How to invoke a shell so it sources its profiles and runs a command.
 * csh/tcsh accept -l only as the sole flag, so they're marked login via the
 * argv[0] dash convention instead (sources ~/.login on top of the always-read
 * ~/.cshrc//.tcshrc); everything else gets login (-l, ~/.zprofile —
 * Homebrew's shellenv) plus interactive (-i, ~/.zshrc — nvm-style version
 * managers) as separate flags.
 */
export function shellInvocation(
	shell: string,
	command: string,
): ShellInvocation {
	const kind = basename(shell);
	if (kind === "csh" || kind === "tcsh") {
		return { args: ["-c", command], argv0: `-${kind}` };
	}
	return { args: ["-i", "-l", "-c", command] };
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
 * Run the user's shell with its profiles sourced and capture its PATH.
 * Resolves to undefined on any failure (missing shell, timeout, profile
 * error) — callers should treat that as "keep the current PATH".
 */
export function resolveLoginShellPath(
	shell: string,
	timeoutMs = SHELL_TIMEOUT_MS,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		const invocation = shellInvocation(shell, PRINT_PATH_COMMAND);
		const child = spawn(shell, invocation.args, {
			argv0: invocation.argv0,
			stdio: ["ignore", "pipe", "ignore"],
			detached: true,
		});

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
 * Resolve the login shell's PATH and merge it into process.env.PATH. The
 * shell comes from the account database (see loginShellFor); if it can't
 * produce a PATH (exotic shell, broken profile), retry once with the
 * platform default shell before giving up.
 *
 * No-op on Windows (the GUI PATH comes from the registry there) and when
 * CLINE_SIDECAR_SKIP_SHELL_PATH is set. Failures are reported via the
 * returned status but never block startup. The result never contains the
 * resolved PATH itself so it is safe to log verbatim.
 */
export async function ensureLoginShellPath(options?: {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	/** Test seam: overrides passwd/$SHELL discovery of the user's shell. */
	userShell?: string;
	/** Test seam: overrides the platform-default fallback shell. */
	fallbackShell?: string;
}): Promise<
	| { status: "applied"; pathEntries: number; shell: string }
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

	const userShell = options?.userShell ?? loginShellFor(platform, env);
	const fallbackShell = options?.fallbackShell ?? defaultShellFor(platform);
	const baseTimeoutMs = options?.timeoutMs ?? SHELL_TIMEOUT_MS;
	// The fallback gets half the budget so the combined worst case stays
	// bounded even when both shells hang (see SHELL_TIMEOUT_MS).
	const attempts: Array<[shell: string, timeoutMs: number]> =
		userShell === fallbackShell
			? [[userShell, baseTimeoutMs]]
			: [
					[userShell, baseTimeoutMs],
					[fallbackShell, baseTimeoutMs / 2],
				];

	for (const [shell, timeoutMs] of attempts) {
		const shellPath = await resolveLoginShellPath(shell, timeoutMs);
		if (!shellPath) {
			continue;
		}
		const merged = mergePaths(shellPath, env.PATH ?? "");
		env.PATH = merged;
		return {
			status: "applied",
			pathEntries: merged.split(delimiter).length,
			shell,
		};
	}
	return { status: "failed", shell: userShell };
}
