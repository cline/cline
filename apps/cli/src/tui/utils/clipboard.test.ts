import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
	spawn: spawnMock,
}));

interface ChildProcessMockOptions {
	closeCode?: number;
	error?: Error;
	hangUntilKilled?: boolean;
	hangUntilAborted?: boolean;
	stdoutText?: string;
}

function createChildProcessMock(options: ChildProcessMockOptions = {}) {
	const child = new EventEmitter() as EventEmitter & {
		stdin: PassThrough;
		stdout: PassThrough;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	const chunks: Buffer[] = [];
	child.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
	child.kill = vi.fn(() => {
		queueMicrotask(() => child.emit("close", 1));
	});
	child.stdin.on("finish", () => {
		queueMicrotask(() => {
			if (options.error) {
				child.emit("error", options.error);
				return;
			}
			if (options.hangUntilKilled || options.hangUntilAborted) {
				return;
			}
			child.emit("close", options.closeCode ?? 0);
		});
	});
	child.on("newListener", (event) => {
		if (event === "close" && options.stdoutText !== undefined) {
			queueMicrotask(() => {
				child.stdout.write(options.stdoutText);
				child.stdout.end();
				if (options.error) {
					child.emit("error", options.error);
					return;
				}
				if (!options.hangUntilKilled && !options.hangUntilAborted) {
					child.emit("close", options.closeCode ?? 0);
				}
			});
		} else if (
			event === "close" &&
			options.closeCode !== undefined &&
			options.stdoutText === undefined
		) {
			queueMicrotask(() => {
				child.stdout.end();
				if (!options.hangUntilKilled && !options.hangUntilAborted) {
					child.emit("close", options.closeCode);
				}
			});
		}
	});
	return {
		child,
		getInput: () => Buffer.concat(chunks).toString("utf8"),
	};
}

const ENV_WITHOUT_SSH: NodeJS.ProcessEnv = {};

describe("copyTextToSystemClipboard", () => {
	beforeEach(() => {
		spawnMock.mockReset();
	});

	it("returns false for empty text and does not spawn", async () => {
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("", {
				platform: "darwin",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(false);
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("copies with pbcopy on macOS, forces UTF-8, and removes LC_ALL", async () => {
		const proc = createChildProcessMock();
		spawnMock.mockReturnValueOnce(proc.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("hello\nworld 👋", {
				platform: "darwin",
				env: { ...ENV_WITHOUT_SSH, LC_ALL: "C", LANG: "C", LC_CTYPE: "C" },
			}),
		).resolves.toBe(true);

		expect(spawnMock).toHaveBeenCalledTimes(1);
		const [command, args, spawnOptions] = spawnMock.mock.calls[0] as [
			string,
			string[],
			{ stdio: unknown; env?: NodeJS.ProcessEnv },
		];
		expect(command).toBe("pbcopy");
		expect(args).toEqual([]);
		expect(spawnOptions.stdio).toEqual(["pipe", "ignore", "ignore"]);
		expect(spawnOptions.env?.LANG).toBe("en_US.UTF-8");
		expect(spawnOptions.env?.LC_CTYPE).toBe("en_US.UTF-8");
		expect(spawnOptions.env?.LC_ALL).toBeUndefined();
		expect(proc.getInput()).toBe("hello\nworld 👋");
	});

	it("falls back from wl-copy to xclip on Linux and writes input to both", async () => {
		const failed = createChildProcessMock({ closeCode: 1 });
		const succeeded = createChildProcessMock();
		spawnMock
			.mockReturnValueOnce(failed.child)
			.mockReturnValueOnce(succeeded.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("selected text", {
				platform: "linux",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(true);

		expect(spawnMock).toHaveBeenNthCalledWith(1, "wl-copy", [], {
			stdio: ["pipe", "ignore", "ignore"],
			windowsHide: true,
		});
		expect(spawnMock).toHaveBeenNthCalledWith(
			2,
			"xclip",
			["-selection", "clipboard"],
			{ stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
		);
		expect(failed.getInput()).toBe("selected text");
		expect(succeeded.getInput()).toBe("selected text");
	});

	it("uses non-WSL Linux path when osRelease lacks any Microsoft marker", async () => {
		const wlcopy = createChildProcessMock();
		spawnMock.mockReturnValueOnce(wlcopy.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("plain linux", {
				platform: "linux",
				osRelease: "6.6.30-arch1-1",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(true);

		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(spawnMock).toHaveBeenCalledWith("wl-copy", [], {
			stdio: ["pipe", "ignore", "ignore"],
			windowsHide: true,
		});
		expect(wlcopy.getInput()).toBe("plain linux");
	});

	it("uses powershell.exe on Windows with UTF-8 stdin and Set-Clipboard", async () => {
		const win = createChildProcessMock();
		spawnMock.mockReturnValueOnce(win.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		const unicode = "hello 👋 日本語 é";
		await expect(
			copyTextToSystemClipboard(unicode, {
				platform: "win32",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(true);

		expect(spawnMock).toHaveBeenCalledTimes(1);
		const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
		expect(command).toBe("powershell.exe");
		expect(args.slice(0, 5)).toEqual([
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
		]);
		expect(args[5]).toContain("Set-Clipboard");
		expect(args[5]).toContain("UTF8Encoding");
		expect(win.getInput()).toBe(unicode);
	});

	it("falls back from powershell.exe to pwsh.exe when the former fails", async () => {
		const failed = createChildProcessMock({ error: new Error("ENOENT") });
		const ok = createChildProcessMock();
		spawnMock.mockReturnValueOnce(failed.child).mockReturnValueOnce(ok.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("hi", {
				platform: "win32",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(true);

		expect(spawnMock).toHaveBeenNthCalledWith(
			1,
			"powershell.exe",
			expect.any(Array),
			expect.objectContaining({ stdio: ["pipe", "ignore", "ignore"] }),
		);
		expect(spawnMock).toHaveBeenNthCalledWith(
			2,
			"pwsh.exe",
			expect.any(Array),
			expect.objectContaining({ stdio: ["pipe", "ignore", "ignore"] }),
		);
		expect(ok.getInput()).toBe("hi");
	});

	it("uses powershell.exe on WSL2 and preserves Unicode", async () => {
		const wsl = createChildProcessMock();
		spawnMock.mockReturnValueOnce(wsl.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		const unicode = "hello 👋 日本語 é";
		await expect(
			copyTextToSystemClipboard(unicode, {
				platform: "linux",
				osRelease: "5.15.0-microsoft-standard-WSL2",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(true);

		const [command] = spawnMock.mock.calls[0] as [string];
		expect(command).toBe("powershell.exe");
		expect(wsl.getInput()).toBe(unicode);
	});

	it("uses powershell.exe on WSL1 (mixed-case Microsoft kernel string)", async () => {
		const proc = createChildProcessMock();
		spawnMock.mockReturnValueOnce(proc.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("wsl1", {
				platform: "linux",
				osRelease: "4.4.0-19041-Microsoft",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(true);

		const [command] = spawnMock.mock.calls[0] as [string];
		expect(command).toBe("powershell.exe");
		expect(proc.getInput()).toBe("wsl1");
	});

	it("skips fallback inside an SSH session", async () => {
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("over ssh", {
				platform: "darwin",
				env: { SSH_CONNECTION: "1.2.3.4 1234 5.6.7.8 22" },
			}),
		).resolves.toBe(false);
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("re-enables SSH fallback when CLINE_CLIPBOARD_FALLBACK_REMOTE=1", async () => {
		const proc = createChildProcessMock();
		spawnMock.mockReturnValueOnce(proc.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("over ssh", {
				platform: "darwin",
				env: {
					SSH_TTY: "/dev/pts/0",
					CLINE_CLIPBOARD_FALLBACK_REMOTE: "1",
				},
			}),
		).resolves.toBe(true);
		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(proc.getInput()).toBe("over ssh");
	});

	it("treats spawn 'error' as failure and tries the next command", async () => {
		const broken = createChildProcessMock({ error: new Error("ENOENT") });
		const ok = createChildProcessMock();
		spawnMock.mockReturnValueOnce(broken.child).mockReturnValueOnce(ok.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("retry", {
				platform: "linux",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(true);
		expect(spawnMock).toHaveBeenCalledTimes(2);
		expect(ok.getInput()).toBe("retry");
	});

	it("times out, kills the child, and falls back to the next command", async () => {
		const stuck = createChildProcessMock({ hangUntilKilled: true });
		const ok = createChildProcessMock();
		spawnMock.mockReturnValueOnce(stuck.child).mockReturnValueOnce(ok.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("slow", {
				platform: "linux",
				env: ENV_WITHOUT_SSH,
				timeoutMs: 5,
			}),
		).resolves.toBe(true);
		expect(stuck.child.kill).toHaveBeenCalled();
		expect(ok.getInput()).toBe("slow");
	});

	it("aborts an in-flight copy via AbortSignal and resolves false", async () => {
		const stuck = createChildProcessMock({ hangUntilAborted: true });
		spawnMock.mockReturnValueOnce(stuck.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");
		const controller = new AbortController();

		const pending = copyTextToSystemClipboard("racing", {
			platform: "darwin",
			env: ENV_WITHOUT_SSH,
			signal: controller.signal,
			timeoutMs: 10_000,
		});
		await Promise.resolve();
		controller.abort();

		await expect(pending).resolves.toBe(false);
		expect(stuck.child.kill).toHaveBeenCalled();
	});

	it("returns false when called with an already-aborted signal", async () => {
		const { copyTextToSystemClipboard } = await import("./clipboard");
		const controller = new AbortController();
		controller.abort();

		await expect(
			copyTextToSystemClipboard("nope", {
				platform: "darwin",
				env: ENV_WITHOUT_SSH,
				signal: controller.signal,
			}),
		).resolves.toBe(false);
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("returns false when the only command fails", async () => {
		spawnMock.mockReturnValueOnce(
			createChildProcessMock({ closeCode: 1 }).child,
		);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("nope", {
				platform: "darwin",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(false);
	});

	it("falls back to next command when child.stdin is null", async () => {
		const noStdin = new EventEmitter() as EventEmitter & {
			stdin: null;
			kill: ReturnType<typeof vi.fn>;
		};
		noStdin.stdin = null;
		noStdin.kill = vi.fn();
		const ok = createChildProcessMock();
		spawnMock.mockReturnValueOnce(noStdin).mockReturnValueOnce(ok.child);
		const { copyTextToSystemClipboard } = await import("./clipboard");

		await expect(
			copyTextToSystemClipboard("recover", {
				platform: "linux",
				env: ENV_WITHOUT_SSH,
			}),
		).resolves.toBe(true);
		expect(spawnMock).toHaveBeenCalledTimes(2);
		expect(ok.getInput()).toBe("recover");
	});
});

describe("readTextFromSystemClipboard", () => {
	beforeEach(() => {
		spawnMock.mockReset();
	});

	it("skips reading inside SSH sessions unless opt-in is set", async () => {
		const { readTextFromSystemClipboard } = await import("./clipboard");

		await expect(
			readTextFromSystemClipboard({
				platform: "linux",
				env: { SSH_CONNECTION: "1.2.3.4 5678 5.6.7.8 22" },
			}),
		).resolves.toBeUndefined();
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("reads clipboard via pbpaste on macOS", async () => {
		const mock = createChildProcessMock({ stdoutText: "hello mac" });
		spawnMock.mockReturnValueOnce(mock.child);
		const { readTextFromSystemClipboard } = await import("./clipboard");

		const result = await readTextFromSystemClipboard({
			platform: "darwin",
			env: ENV_WITHOUT_SSH,
		});

		expect(result).toBe("hello mac");
		expect(spawnMock).toHaveBeenCalledWith(
			"pbpaste",
			[],
			expect.objectContaining({
				stdio: ["ignore", "pipe", "ignore"],
			}),
		);
	});

	it("normalizes carriage returns and strips ANSI sequences from pasted text", async () => {
		const mock = createChildProcessMock({
			stdoutText: "\x1b[31mhello\x1b[0m\r\nworld\r!",
		});
		spawnMock.mockReturnValueOnce(mock.child);
		const { readTextFromSystemClipboard } = await import("./clipboard");

		const result = await readTextFromSystemClipboard({
			platform: "darwin",
			env: ENV_WITHOUT_SSH,
		});

		expect(result).toBe("hello\nworld\n!");
	});

	it("falls back to next command on Linux when first command fails", async () => {
		const failMock = createChildProcessMock({ closeCode: 1 });
		const successMock = createChildProcessMock({ stdoutText: "from xclip" });
		spawnMock.mockReturnValueOnce(failMock.child).mockReturnValueOnce(successMock.child);
		const { readTextFromSystemClipboard } = await import("./clipboard");

		const result = await readTextFromSystemClipboard({
			platform: "linux",
			osRelease: "6.8.0-generic",
			env: ENV_WITHOUT_SSH,
		});

		expect(result).toBe("from xclip");
		expect(spawnMock).toHaveBeenCalledTimes(2);
		expect(spawnMock).toHaveBeenNthCalledWith(1, "wl-paste", ["--no-newline"], expect.any(Object));
		expect(spawnMock).toHaveBeenNthCalledWith(2, "xclip", ["-selection", "clipboard", "-o"], expect.any(Object));
	});

	it("reads clipboard on Windows via powershell", async () => {
		const mock = createChildProcessMock({ stdoutText: "windows clipboard" });
		spawnMock.mockReturnValueOnce(mock.child);
		const { readTextFromSystemClipboard } = await import("./clipboard");

		const result = await readTextFromSystemClipboard({
			platform: "win32",
			env: ENV_WITHOUT_SSH,
		});

		expect(result).toBe("windows clipboard");
		expect(spawnMock).toHaveBeenCalledWith(
			"powershell.exe",
			expect.arrayContaining(["-Command"]),
			expect.any(Object),
		);
	});

	it("falls back to python3 X11 script on Linux when wl-paste, xclip, and xsel fail", async () => {
		const failMock = () => createChildProcessMock({ closeCode: 1 }).child;
		const successMock = createChildProcessMock({ stdoutText: "from python x11" });
		spawnMock
			.mockReturnValueOnce(failMock())
			.mockReturnValueOnce(failMock())
			.mockReturnValueOnce(failMock())
			.mockReturnValueOnce(successMock.child);
		const { readTextFromSystemClipboard } = await import("./clipboard");

		const result = await readTextFromSystemClipboard({
			platform: "linux",
			osRelease: "6.8.0-generic",
			env: { ...ENV_WITHOUT_SSH, DISPLAY: ":0" },
		});

		expect(result).toBe("from python x11");
		expect(spawnMock).toHaveBeenCalledTimes(4);
		expect(spawnMock).toHaveBeenNthCalledWith(
			4,
			"python3",
			expect.arrayContaining(["-c"]),
			expect.any(Object),
		);
	});

	it("returns undefined if all commands fail or return empty", async () => {
		spawnMock.mockImplementation(() => createChildProcessMock({ closeCode: 1 }).child);
		const { readTextFromSystemClipboard } = await import("./clipboard");

		const result = await readTextFromSystemClipboard({
			platform: "darwin",
			env: ENV_WITHOUT_SSH,
		});

		expect(result).toBeUndefined();
	});
});


