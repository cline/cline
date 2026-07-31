import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	spawnMock: vi.fn(),
	readFileSyncMock: vi.fn(),
	existsSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: hoisted.spawnMock }));
vi.mock("node:fs", () => ({
	readFileSync: hoisted.readFileSyncMock,
	existsSync: hoisted.existsSyncMock,
}));

type FakeChild = EventEmitter & { unref: ReturnType<typeof vi.fn> };

function makeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.unref = vi.fn();
	return child;
}

/** Hands out one fresh child per spawn() call so a fallback chain can be driven. */
function queueChildren(count: number): FakeChild[] {
	const children = Array.from({ length: count }, makeChild);
	let index = 0;
	hoisted.spawnMock.mockImplementation(
		() => children[Math.min(index++, children.length - 1)],
	);
	return children;
}

/** Lets the pending `.then` chain advance to the next spawn attempt. */
function flush(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function setPlatform(platform: NodeJS.Platform): () => void {
	const original = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { value: platform });
	return () => {
		if (original) {
			Object.defineProperty(process, "platform", original);
		}
	};
}

// The WSL/mount-point probes are memoized per module instance, so each test
// gets a fresh one.
async function loadOpenUrl(): Promise<(url: string) => Promise<boolean>> {
	vi.resetModules();
	return (await import("./open-url")).openUrlInBrowser;
}

beforeEach(() => {
	hoisted.readFileSyncMock.mockImplementation((path: string) => {
		throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
	});
	hoisted.existsSyncMock.mockReturnValue(false);
});

afterEach(() => {
	hoisted.spawnMock.mockReset();
	hoisted.readFileSyncMock.mockReset();
	hoisted.existsSyncMock.mockReset();
});

describe("openUrlInBrowser (direct opener: darwin / non-WSL linux)", () => {
	it("resolves true when the opener process spawns", async () => {
		const openUrlInBrowser = await loadOpenUrl();
		const [child] = queueChildren(1);
		const result = openUrlInBrowser("https://example.com");
		child.emit("spawn");
		await expect(result).resolves.toBe(true);
		expect(child.unref).toHaveBeenCalled();
	});

	it("survives an error emitted before any await boundary", async () => {
		// The decisive ordering case: Bun emits the missing-binary ENOENT
		// ahead of the microtask queue, so a listener attached after an
		// `await` misses it and the listenerless `error` event kills the
		// process. Emitting on nextTick (before microtasks drain) reproduces
		// that ordering; only a same-tick listener can catch it.
		const openUrlInBrowser = await loadOpenUrl();
		const [child] = queueChildren(1);
		const result = openUrlInBrowser("https://example.com");
		process.nextTick(() => {
			child.emit(
				"error",
				Object.assign(new Error('Executable not found in $PATH: "xdg-open"'), {
					code: "ENOENT",
				}),
			);
		});
		await expect(result).resolves.toBe(false);
	});

	it("resolves false when spawn() itself throws", async () => {
		const openUrlInBrowser = await loadOpenUrl();
		hoisted.spawnMock.mockImplementation(() => {
			throw new Error("spawn failure");
		});
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
	});

	it("passes the URL as a plain argument to the platform opener", async () => {
		const openUrlInBrowser = await loadOpenUrl();
		const [child] = queueChildren(1);
		const url = "https://example.com/device?user_code=ABCD-EFGH&x=1";
		const result = openUrlInBrowser(url);
		child.emit("spawn");
		await result;
		expect(hoisted.spawnMock).toHaveBeenCalledWith(
			expect.any(String),
			[url],
			expect.objectContaining({ detached: true }),
		);
	});

	it("ignores a post-spawn error instead of letting it escalate", async () => {
		const openUrlInBrowser = await loadOpenUrl();
		const [child] = queueChildren(1);
		const result = openUrlInBrowser("https://example.com");
		child.emit("spawn");
		await expect(result).resolves.toBe(true);
		// An `error` event with no listener becomes an uncaughtException, so the
		// listener has to outlive the resolved promise.
		expect(() => child.emit("error", new Error("late failure"))).not.toThrow();
	});

	it("falls back to /usr/bin/open when `open` is not on PATH (macOS)", async () => {
		const restore = setPlatform("darwin");
		try {
			const openUrlInBrowser = await loadOpenUrl();
			const [first, second] = queueChildren(2);
			const result = openUrlInBrowser("https://example.com");
			first.emit("error", new Error("spawn open ENOENT"));
			await flush();
			second.emit("spawn");
			await expect(result).resolves.toBe(true);
			expect(hoisted.spawnMock.mock.calls.map((call) => call[0])).toEqual([
				"open",
				"/usr/bin/open",
			]);
		} finally {
			restore();
		}
	});
});

describe("openUrlInBrowser (win32: powershell -EncodedCommand)", () => {
	it("spawns powershell with the URL base64-encoded, never shell-interpolated", async () => {
		const restore = setPlatform("win32");
		const originalSystemRoot = process.env.SYSTEMROOT;
		process.env.SYSTEMROOT = "C:\\Windows";
		try {
			const openUrlInBrowser = await loadOpenUrl();
			const [child] = queueChildren(1);
			const url = "https://example.com/device?user_code=ABCD-EFGH&x=1";
			const result = openUrlInBrowser(url);
			child.emit("spawn");
			await expect(result).resolves.toBe(true);
			const [command, args] = hoisted.spawnMock.mock.calls[0];
			// An absolute path, not a bare `powershell`: PATH is not guaranteed to
			// carry System32.
			expect(command).toBe(
				"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			);
			const encoded = args[args.indexOf("-EncodedCommand") + 1];
			expect(Buffer.from(encoded, "base64").toString("utf16le")).toBe(
				`Start-Process '${url}'`,
			);
			expect(args).not.toContain(url);
		} finally {
			process.env.SYSTEMROOT = originalSystemRoot;
			restore();
		}
	});

	it("escapes single quotes in the target", async () => {
		const restore = setPlatform("win32");
		try {
			const openUrlInBrowser = await loadOpenUrl();
			const [child] = queueChildren(1);
			const result = openUrlInBrowser("https://example.com/?q=it's");
			child.emit("spawn");
			await result;
			const args = hoisted.spawnMock.mock.calls[0][1];
			const encoded = args[args.indexOf("-EncodedCommand") + 1];
			expect(Buffer.from(encoded, "base64").toString("utf16le")).toBe(
				"Start-Process 'https://example.com/?q=it''s'",
			);
		} finally {
			restore();
		}
	});

	it("falls back to powershell.exe on PATH when SYSTEMROOT is wrong", async () => {
		const restore = setPlatform("win32");
		try {
			const openUrlInBrowser = await loadOpenUrl();
			const [first, second] = queueChildren(2);
			const result = openUrlInBrowser("https://example.com");
			first.emit("error", new Error("spawn ENOENT"));
			await flush();
			second.emit("spawn");
			await expect(result).resolves.toBe(true);
			expect(hoisted.spawnMock.mock.calls[1][0]).toBe("powershell.exe");
		} finally {
			restore();
		}
	});

	it("survives a pre-microtask error on win32 too", async () => {
		const restore = setPlatform("win32");
		try {
			const openUrlInBrowser = await loadOpenUrl();
			const children = queueChildren(2);
			const result = openUrlInBrowser("https://example.com");
			for (const child of children) {
				process.nextTick(() => {
					child.emit(
						"error",
						Object.assign(new Error("spawn powershell EPERM"), {
							code: "EPERM",
						}),
					);
				});
				await flush();
			}
			await expect(result).resolves.toBe(false);
		} finally {
			restore();
		}
	});
});

describe("openUrlInBrowser (WSL)", () => {
	function underWsl(
		procVersion = "Linux version 5.15.0-microsoft-standard-WSL2",
	) {
		hoisted.readFileSyncMock.mockImplementation((path: string) => {
			if (path === "/proc/version") {
				return procVersion;
			}
			throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
		});
	}

	it("uses the absolute Windows PowerShell path under /mnt", async () => {
		const restore = setPlatform("linux");
		try {
			underWsl();
			const openUrlInBrowser = await loadOpenUrl();
			const [child] = queueChildren(1);
			const result = openUrlInBrowser("https://example.com");
			child.emit("spawn");
			await expect(result).resolves.toBe(true);
			// `[interop] appendWindowsPath = false` keeps powershell.exe off PATH,
			// so a bare command name is not enough.
			expect(hoisted.spawnMock.mock.calls[0][0]).toBe(
				"/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
			);
		} finally {
			restore();
		}
	});

	it("honors a relocated automount root from /etc/wsl.conf", async () => {
		const restore = setPlatform("linux");
		try {
			hoisted.readFileSyncMock.mockImplementation((path: string) => {
				if (path === "/proc/version") {
					return "Linux version 5.15.0-microsoft-standard-WSL2";
				}
				if (path === "/etc/wsl.conf") {
					return "[automount]\n# root = /ignored/\nroot = /windir\n";
				}
				throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
			});
			const openUrlInBrowser = await loadOpenUrl();
			const [child] = queueChildren(1);
			const result = openUrlInBrowser("https://example.com");
			child.emit("spawn");
			await result;
			expect(hoisted.spawnMock.mock.calls[0][0]).toBe(
				"/windir/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
			);
		} finally {
			restore();
		}
	});

	it("falls back to xdg-open when there is no Windows side (container on the WSL2 kernel)", async () => {
		const restore = setPlatform("linux");
		try {
			underWsl();
			const openUrlInBrowser = await loadOpenUrl();
			const [first, second, third] = queueChildren(3);
			const result = openUrlInBrowser("https://example.com");
			first.emit("error", new Error("spawn ENOENT"));
			await flush();
			second.emit("error", new Error("spawn ENOENT"));
			await flush();
			third.emit("spawn");
			await expect(result).resolves.toBe(true);
			expect(hoisted.spawnMock.mock.calls.map((call) => call[0])).toEqual([
				"/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
				"powershell.exe",
				"xdg-open",
			]);
			expect(hoisted.spawnMock.mock.calls[2][1]).toEqual([
				"https://example.com",
			]);
		} finally {
			restore();
		}
	});

	it("detects WSL through interop artifacts when /proc/version lacks the marker", async () => {
		const restore = setPlatform("linux");
		try {
			hoisted.readFileSyncMock.mockImplementation((path: string) => {
				if (path === "/proc/version") {
					return "Linux version 6.6.0-custom";
				}
				throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
			});
			hoisted.existsSyncMock.mockImplementation(
				(path: string) => path === "/proc/sys/fs/binfmt_misc/WSLInterop",
			);
			const openUrlInBrowser = await loadOpenUrl();
			const [child] = queueChildren(1);
			const result = openUrlInBrowser("https://example.com");
			child.emit("spawn");
			await result;
			expect(hoisted.spawnMock.mock.calls[0][0]).toContain("powershell.exe");
		} finally {
			restore();
		}
	});

	it("stays on xdg-open for ordinary linux", async () => {
		const restore = setPlatform("linux");
		try {
			const openUrlInBrowser = await loadOpenUrl();
			const [child] = queueChildren(1);
			const result = openUrlInBrowser("https://example.com");
			child.emit("spawn");
			await result;
			expect(hoisted.spawnMock.mock.calls.map((call) => call[0])).toEqual([
				"xdg-open",
			]);
		} finally {
			restore();
		}
	});
});
