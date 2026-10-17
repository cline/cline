import { spawn } from "node:child_process";
import { release } from "node:os";
import { stripAnsiSequences } from "@opentui/core";

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

const POWERSHELL_GET_CLIPBOARD_SCRIPT = [
	"$ErrorActionPreference = 'Stop';",
	"[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false;",
	"Get-Clipboard -Raw;",
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

function powershellReadClipboardCommand(executable: string): ClipboardCommand {
	return {
		command: executable,
		args: [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			POWERSHELL_GET_CLIPBOARD_SCRIPT,
		],
	};
}

function powershellReadClipboardCommands(): ClipboardCommand[] {
	return [
		powershellReadClipboardCommand("powershell.exe"),
		powershellReadClipboardCommand("pwsh.exe"),
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
			// Prevent a console window from flashing on Windows.
			windowsHide: true,
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

function normalizePasteText(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

const PYTHON_X11_READ_CLIPBOARD_SCRIPT = [
	"import ctypes, time, sys",
	"try:",
	'    X = ctypes.cdll.LoadLibrary("libX11.so.6")',
	"    # Declare return/argument types for 64-bit pointer safety",
	"    X.XOpenDisplay.restype = ctypes.c_void_p",
	"    X.XOpenDisplay.argtypes = [ctypes.c_char_p]",
	"    X.XDefaultRootWindow.restype = ctypes.c_ulong",
	"    X.XDefaultRootWindow.argtypes = [ctypes.c_void_p]",
	"    X.XCreateSimpleWindow.restype = ctypes.c_ulong",
	"    X.XCreateSimpleWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]",
	"    X.XInternAtom.restype = ctypes.c_ulong",
	"    X.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]",
	"    X.XConvertSelection.restype = ctypes.c_int",
	"    X.XConvertSelection.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]",
	"    X.XFlush.restype = ctypes.c_int",
	"    X.XFlush.argtypes = [ctypes.c_void_p]",
	"    X.XCheckTypedWindowEvent.restype = ctypes.c_int",
	"    X.XCheckTypedWindowEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_void_p]",
	"    X.XGetWindowProperty.restype = ctypes.c_int",
	"    X.XGetWindowProperty.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_long, ctypes.c_long, ctypes.c_int, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_char_p)]",
	"    X.XFree.restype = ctypes.c_int",
	"    X.XFree.argtypes = [ctypes.c_void_p]",
	"    X.XDestroyWindow.restype = ctypes.c_int",
	"    X.XDestroyWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]",
	"    X.XCloseDisplay.restype = ctypes.c_int",
	"    X.XCloseDisplay.argtypes = [ctypes.c_void_p]",
	"    class XSelectionEvent(ctypes.Structure):",
	"        _fields_ = [",
	'            ("type", ctypes.c_int), ("serial", ctypes.c_ulong), ("send_event", ctypes.c_int),',
	'            ("display", ctypes.c_void_p), ("requestor", ctypes.c_ulong), ("selection", ctypes.c_ulong),',
	'            ("target", ctypes.c_ulong), ("property", ctypes.c_ulong), ("time", ctypes.c_ulong),',
	"        ]",
	"    class XEvent(ctypes.Union):",
	'        _fields_ = [("type", ctypes.c_int), ("xselection", XSelectionEvent), ("pad", ctypes.c_byte * 192)]',
	"    d = X.XOpenDisplay(None)",
	"    if not d: sys.exit(1)",
	"    root = X.XDefaultRootWindow(d)",
	"    win = X.XCreateSimpleWindow(d, root, -10, -10, 1, 1, 0, 0, 0)",
	'    utf8 = X.XInternAtom(d, b"UTF8_STRING", False)',
	'    prop = X.XInternAtom(d, b"XSEL_DATA", False)',
	"    text = None",
	'    for sel_name in [b"CLIPBOARD", b"PRIMARY"]:',
	"        sel = X.XInternAtom(d, sel_name, False)",
	"        X.XConvertSelection(d, sel, utf8, prop, win, 0)",
	"        X.XFlush(d)",
	"        evt = XEvent()",
	"        start = time.time()",
	"        found = False",
	"        while time.time() - start < 0.25:",
	"            if X.XCheckTypedWindowEvent(d, win, 31, ctypes.byref(evt)):",
	"                found = True",
	"                break",
	"            time.sleep(0.005)",
	"        if found and evt.xselection.property != 0:",
	"            actual_type, actual_format = ctypes.c_ulong(), ctypes.c_int()",
	"            nitems, bytes_after = ctypes.c_ulong(), ctypes.c_ulong()",
	"            data = ctypes.c_char_p()",
	"            X.XGetWindowProperty(d, win, prop, 0, 1024*1024, True, 0,",
	"                                 ctypes.byref(actual_type), ctypes.byref(actual_format),",
	"                                 ctypes.byref(nitems), ctypes.byref(bytes_after), ctypes.byref(data))",
	"            if data.value:",
	"                text = data.value",
	"            X.XFree(data)",
	"            if text:",
	"                break",
	"    X.XDestroyWindow(d, win)",
	"    X.XCloseDisplay(d)",
	"    if text:",
	"        sys.stdout.buffer.write(text)",
	"        sys.exit(0)",
	"    sys.exit(1)",
	"except Exception:",
	"    sys.exit(1)",
].join("\n");

function getReadClipboardCommands(
	options: CopyTextOptions = {},
): ClipboardCommand[] {
	const platform = options.platform ?? process.platform;
	const osRelease = options.osRelease ?? release();
	const env = options.env ?? process.env;

	if (platform === "darwin") {
		return [
			{
				command: "pbpaste",
				args: [],
				env: macosClipboardEnv(env),
			},
		];
	}

	if (platform === "win32") {
		return powershellReadClipboardCommands();
	}

	if (platform === "linux" && isWslRelease(osRelease)) {
		return powershellReadClipboardCommands();
	}

	if (platform === "linux") {
		const commands: ClipboardCommand[] = [
			{ command: "wl-paste", args: ["--no-newline"] },
			{
				command: "xclip",
				args: ["-selection", "clipboard", "-o"],
			},
			{
				command: "xsel",
				args: ["--clipboard", "--output"],
			},
		];

		if (env.DISPLAY) {
			commands.push(
				{
					command: "python3",
					args: ["-c", PYTHON_X11_READ_CLIPBOARD_SCRIPT],
				},
				{
					command: "python",
					args: ["-c", PYTHON_X11_READ_CLIPBOARD_SCRIPT],
				},
			);
		}

		return commands;
	}

	return [];
}

function runReadClipboardCommand(
	command: ClipboardCommand,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve(undefined);
			return;
		}

		const child = spawn(command.command, command.args, {
			stdio: ["ignore", "pipe", "ignore"],
			...(command.env ? { env: command.env } : {}),
			windowsHide: true,
		});
		if (!child) {
			resolve(undefined);
			return;
		}
		const chunks: Buffer[] = [];
		let total = 0;
		let settled = false;

		const onAbort = () => {
			child.kill?.();
			finish(undefined);
		};

		const finish = (output: string | undefined) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve(output);
		};

		const timer = setTimeout(() => {
			child.kill?.();
			finish(undefined);
		}, timeoutMs);

		signal?.addEventListener("abort", onAbort, { once: true });

		child.on("error", () => finish(undefined));
		child.stdout?.on("data", (chunk: Buffer) => {
			total += chunk.length;
			if (total > 20 * 1024 * 1024) {
				child.kill();
				finish(undefined);
				return;
			}
			chunks.push(chunk);
		});
		child.on("close", (code) => {
			if (code !== 0 || chunks.length === 0) {
				finish(undefined);
				return;
			}
			const raw = Buffer.concat(chunks).toString("utf8");
			const sanitized = normalizePasteText(stripAnsiSequences(raw));
			finish(sanitized);
		});
	});
}

export async function readTextFromSystemClipboard(
	options: CopyTextOptions = {},
): Promise<string | undefined> {
	const env = options.env ?? process.env;
	if (isRemoteSession(env)) {
		debugLog(
			env,
			`skipped fallback inside SSH session; set ${CLIPBOARD_FALLBACK_REMOTE_ENV}=1 to opt in`,
		);
		return undefined;
	}

	const timeoutMs = options.timeoutMs ?? CLIPBOARD_COMMAND_TIMEOUT_MS;
	for (const command of getReadClipboardCommands(options)) {
		if (options.signal?.aborted) {
			return undefined;
		}
		const result = await runReadClipboardCommand(
			command,
			timeoutMs,
			options.signal,
		);
		if (result !== undefined) {
			return result;
		}
		debugLog(env, `command "${command.command}" did not succeed; trying next`);
	}

	return undefined;
}
