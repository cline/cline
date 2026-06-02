import { spawn } from "node:child_process";
import { release } from "node:os";

const CLIPBOARD_COMMAND_TIMEOUT_MS = 1500;

// Skipping the fallback inside SSH sessions is the safe default: OSC52 is the
// mechanism that targets the user's local terminal clipboard, while the
// fallback would write to the remote host instead. Setting
// CLINE_CLIPBOARD_FALLBACK_REMOTE=1 opts back in for users who explicitly
// want the remote machine's clipboard.
const CLIPBOARD_FALLBACK_REMOTE_ENV = "CLINE_CLIPBOARD_FALLBACK_REMOTE";

// Setting CLINE_DEBUG_CLIPBOARD=1 logs why the fallback skipped or which
// command failed; off by default so the TUI canvas stays clean.
const CLIPBOARD_DEBUG_ENV = "CLINE_DEBUG_CLIPBOARD";

function debugLog(env: NodeJS.ProcessEnv, message: string): void {
	if (env[CLIPBOARD_DEBUG_ENV]?.trim() === "1") {
		console.debug(`[clipboard] ${message}`);
	}
}

interface ClipboardCommand {
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
	stdinEncoding?: BufferEncoding;
}

interface CopyTextOptions {
	platform?: NodeJS.Platform;
	osRelease?: string;
	timeoutMs?: number;
	env?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
}

function isWslRelease(osRelease: string): boolean {
	return /microsoft/i.test(osRelease);
}

function isRemoteSession(env: NodeJS.ProcessEnv): boolean {
	const remote =
		env.SSH_CONNECTION?.trim() || env.SSH_CLIENT?.trim() || env.SSH_TTY?.trim();
	if (!remote) {
		return false;
	}
	return env[CLIPBOARD_FALLBACK_REMOTE_ENV]?.trim() !== "1";
}

function macosClipboardEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const next: NodeJS.ProcessEnv = {
		...env,
		LANG: "en_US.UTF-8",
		LC_CTYPE: "en_US.UTF-8",
	};
	delete next.LC_ALL;
	return next;
}

const POWERSHELL_SET_CLIPBOARD_SCRIPT = [
	"$ErrorActionPreference = 'Stop';",
	"[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false;",
	"$text = [Console]::In.ReadToEnd();",
	"Set-Clipboard -Value $text;",
].join(" ");

function powershellClipboardCommand(executable: string): ClipboardCommand {
	return {
		command: executable,
		args: [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			POWERSHELL_SET_CLIPBOARD_SCRIPT,
		],
		stdinEncoding: "utf8",
	};
}

function powershellClipboardCommands(): ClipboardCommand[] {
	return [
		powershellClipboardCommand("powershell.exe"),
		powershellClipboardCommand("pwsh.exe"),
	];
}

function getClipboardCommands(
	options: CopyTextOptions = {},
): ClipboardCommand[] {
	const platform = options.platform ?? process.platform;
	const osRelease = options.osRelease ?? release();
	const env = options.env ?? process.env;

	if (platform === "darwin") {
		return [
			{
				command: "pbcopy",
				args: [],
				env: macosClipboardEnv(env),
				stdinEncoding: "utf8",
			},
		];
	}

	if (platform === "win32") {
		return powershellClipboardCommands();
	}

	if (platform === "linux" && isWslRelease(osRelease)) {
		return powershellClipboardCommands();
	}

	if (platform === "linux") {
		return [
			{ command: "wl-copy", args: [], stdinEncoding: "utf8" },
			{
				command: "xclip",
				args: ["-selection", "clipboard"],
				stdinEncoding: "utf8",
			},
		];
	}

	return [];
}

function runClipboardCommand(
	command: ClipboardCommand,
	text: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<boolean> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve(false);
			return;
		}

		const child = spawn(command.command, command.args, {
			stdio: ["pipe", "ignore", "ignore"],
			...(command.env ? { env: command.env } : {}),
		});
		let settled = false;

		const onAbort = () => {
			child.kill();
			finish(false);
		};

		const finish = (success: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve(success);
		};

		const timer = setTimeout(() => {
			child.kill();
			finish(false);
		}, timeoutMs);

		signal?.addEventListener("abort", onAbort, { once: true });

		child.on("error", () => finish(false));
		child.on("close", (code) => finish(code === 0));

		const stdin = child.stdin;
		if (!stdin) {
			finish(false);
			return;
		}
		stdin.on("error", () => finish(false));
		stdin.end(text, command.stdinEncoding ?? "utf8");
	});
}

export async function copyTextToSystemClipboard(
	text: string,
	options: CopyTextOptions = {},
): Promise<boolean> {
	if (!text) {
		return false;
	}

	const env = options.env ?? process.env;
	if (isRemoteSession(env)) {
		debugLog(
			env,
			`skipped fallback inside SSH session; set ${CLIPBOARD_FALLBACK_REMOTE_ENV}=1 to opt in`,
		);
		return false;
	}

	const timeoutMs = options.timeoutMs ?? CLIPBOARD_COMMAND_TIMEOUT_MS;
	for (const command of getClipboardCommands(options)) {
		if (options.signal?.aborted) {
			return false;
		}
		if (await runClipboardCommand(command, text, timeoutMs, options.signal)) {
			return true;
		}
		debugLog(env, `command "${command.command}" did not succeed; trying next`);
	}

	return false;
}
