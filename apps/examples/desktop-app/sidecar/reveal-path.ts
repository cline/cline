import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { platform } from "node:os";
import { dirname, isAbsolute, win32 } from "node:path";

/** How long a launcher may keep running before it is assumed to have handed off. */
const LAUNCH_GRACE_MS = 2_000;

type Launch = {
	command: string;
	args: string[];
	/** Explorer exits nonzero when it hands off to an existing window. */
	ignoreExitCode?: boolean;
	/** Pass the arguments to Windows exactly as written. */
	verbatimArguments?: boolean;
};

function launchFor(os: string, path: string, isDirectory: boolean): Launch {
	if (os === "darwin") return { command: "open", args: ["-R", path] };
	if (os === "win32") {
		// Explorer splits unquoted arguments at commas and needs backslashes,
		// so quote the whole path ourselves instead of relying on Node's quoting.
		return {
			command: "explorer.exe",
			args: [`/select,"${win32.normalize(path)}"`],
			ignoreExitCode: true,
			verbatimArguments: true,
		};
	}
	// There is no portable way to select a file, so open its folder.
	return { command: "xdg-open", args: [isDirectory ? path : dirname(path)] };
}

/**
 * Start the file manager without waiting for it to close: some launchers run
 * the file manager in the foreground and would otherwise never return.
 */
function launch({ command, args, ignoreExitCode, verbatimArguments }: Launch) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "ignore",
			detached: true,
			windowsHide: true,
			windowsVerbatimArguments: verbatimArguments,
		});
		let settled = false;
		const settle = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.unref();
			if (error) reject(error);
			else resolve();
		};
		// Still running after the grace period: the file manager took over.
		const timer = setTimeout(() => settle(), LAUNCH_GRACE_MS);
		child.once("error", (error) =>
			settle(new Error(`Could not open file location: ${error.message}`)),
		);
		child.once("spawn", () => {
			if (ignoreExitCode) settle();
		});
		child.once("exit", (code) =>
			settle(
				code && !ignoreExitCode
					? new Error(
							`Could not open file location: ${command} exited with code ${code}`,
						)
					: undefined,
			),
		);
	});
}

/** Reveal a local path in the system file manager without opening the file. */
export async function revealPath(path: unknown): Promise<void> {
	if (typeof path !== "string" || !path.trim()) {
		throw new Error("path is required");
	}
	if (!isAbsolute(path) || path.includes("\0")) {
		throw new Error("path must be an absolute local path");
	}

	const entry = await stat(path).catch(() => {
		throw new Error(`Path not found or inaccessible: ${path}`);
	});
	await launch(launchFor(platform(), path, entry.isDirectory()));
}
