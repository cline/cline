import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	spawnMock: vi.fn(),
	execFileSyncMock: vi.fn(),
	readFileSyncMock: vi.fn<(path: string, encoding: string) => string>(() => {
		throw new Error("ENOENT");
	}),
	existsSyncMock: vi.fn<(path: string) => boolean>(() => false),
}));

vi.mock("node:child_process", () => ({
	spawn: hoisted.spawnMock,
	execFileSync: hoisted.execFileSyncMock,
}));

vi.mock("node:fs", () => ({
	readFileSync: hoisted.readFileSyncMock,
	existsSync: hoisted.existsSyncMock,
}));

import { openUrlInBrowser } from "./open-url";

type FakeChild = EventEmitter & { unref: ReturnType<typeof vi.fn> };

function makeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.unref = vi.fn();
	return child;
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

/**
 * Returns a fresh copy of the module so per-test fs mocks aren't defeated by
 * the module-level WSL cache.
 */
async function freshOpenUrlInBrowser(): Promise<typeof openUrlInBrowser> {
	vi.resetModules();
	const module_ = await import("./open-url");
	return module_.openUrlInBrowser;
}

function decodePowerShellCommand(args: string[]): string {
	const encoded = args[args.indexOf("-EncodedCommand") + 1];
	return Buffer.from(encoded, "base64").toString("utf16le");
}

afterEach(() => {
	hoisted.spawnMock.mockReset();
	hoisted.execFileSyncMock.mockReset();
	hoisted.readFileSyncMock.mockReset();
	hoisted.readFileSyncMock.mockImplementation(() => {
		throw new Error("ENOENT");
	});
	hoisted.existsSyncMock.mockReset();
	hoisted.existsSyncMock.mockReturnValue(false);
});

describe("openUrlInBrowser (direct opener: darwin / non-WSL linux)", () => {
	it("resolves true when the opener process spawns", async () => {
		const child = makeChild();
		hoisted.spawnMock.mockReturnValue(child);
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
		const child = makeChild();
		hoisted.spawnMock.mockReturnValue(child);
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
		hoisted.spawnMock.mockImplementation(() => {
			throw new Error("spawn failure");
		});
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
	});

	it("passes the URL as a plain argument to the platform opener", async () => {
		const child = makeChild();
		hoisted.spawnMock.mockReturnValue(child);
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
});

describe("openUrlInBrowser (win32: powershell -EncodedCommand)", () => {
	it("spawns the absolute PowerShell path with the URL base64-encoded, never shell-interpolated", async () => {
		const restore = setPlatform("win32");
		try {
			const child = makeChild();
			hoisted.spawnMock.mockReturnValue(child);
			const url = "https://example.com/device?user_code=ABCD-EFGH&x=1";
			const result = openUrlInBrowser(url);
			child.emit("spawn");
			await expect(result).resolves.toBe(true);
			const [command, args] = hoisted.spawnMock.mock.calls[0];
			expect(command).toMatch(
				/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/,
			);
			expect(decodePowerShellCommand(args)).toBe(`Start-Process '${url}'`);
			expect(args).not.toContain(url);
		} finally {
			restore();
		}
	});

	it("falls back to `powershell` on PATH when the absolute path fails", async () => {
		const restore = setPlatform("win32");
		try {
			let call = 0;
			hoisted.spawnMock.mockImplementation(() => {
				const child = makeChild();
				const isFirst = call === 0;
				call += 1;
				process.nextTick(() => {
					if (isFirst) {
						child.emit(
							"error",
							Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
						);
					} else {
						child.emit("spawn");
					}
				});
				return child;
			});
			await expect(openUrlInBrowser("https://example.com")).resolves.toBe(
				true,
			);
			expect(hoisted.spawnMock).toHaveBeenCalledTimes(2);
			expect(hoisted.spawnMock.mock.calls[1][0]).toBe("powershell");
		} finally {
			restore();
		}
	});

	it("resolves false when every candidate errors", async () => {
		const restore = setPlatform("win32");
		try {
			hoisted.spawnMock.mockImplementation(() => {
				const child = makeChild();
				process.nextTick(() => {
					child.emit(
						"error",
						Object.assign(new Error("spawn EPERM"), { code: "EPERM" }),
					);
				});
				return child;
			});
			await expect(openUrlInBrowser("https://example.com")).resolves.toBe(
				false,
			);
			expect(hoisted.spawnMock).toHaveBeenCalledTimes(2);
		} finally {
			restore();
		}
	});
});

describe("openUrlInBrowser (WSL)", () => {
	function mockWslKernel(): void {
		hoisted.readFileSyncMock.mockReturnValue(
			"Linux version 5.15.90.1-microsoft-standard-WSL2",
		);
	}

	it("tries powershell.exe, the absolute mount path, then xdg-open", async () => {
		mockWslKernel();
		const open = await freshOpenUrlInBrowser();
		const children = [makeChild(), makeChild(), makeChild()];
		let call = 0;
		hoisted.spawnMock.mockImplementation(() => {
			const child = children[call];
			const isLast = call === children.length - 1;
			call += 1;
			process.nextTick(() => {
				if (isLast) {
					child.emit("spawn");
				} else {
					child.emit(
						"error",
						Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
					);
				}
			});
			return child;
		});
		const url = "https://example.com";
		await expect(open(url)).resolves.toBe(true);
		expect(hoisted.spawnMock.mock.calls.map((c) => c[0])).toEqual([
			"powershell.exe",
			"/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
			"xdg-open",
		]);
		expect(hoisted.spawnMock.mock.calls[2][1]).toEqual([url]);
	});

	it("converts Linux file paths to Windows paths for PowerShell but not for xdg-open", async () => {
		mockWslKernel();
		hoisted.execFileSyncMock.mockReturnValue(
			String.raw`\\wsl$\Ubuntu\home\me\cli.log` + "\n",
		);
		const open = await freshOpenUrlInBrowser();
		const child = makeChild();
		hoisted.spawnMock.mockImplementation(() => {
			process.nextTick(() => child.emit("spawn"));
			return child;
		});
		await expect(open("/home/me/cli.log")).resolves.toBe(true);
		expect(hoisted.execFileSyncMock).toHaveBeenCalledWith(
			"wslpath",
			["-aw", "/home/me/cli.log"],
			expect.anything(),
		);
		const [, args] = hoisted.spawnMock.mock.calls[0];
		expect(decodePowerShellCommand(args)).toBe(
			String.raw`Start-Process '\\wsl$\Ubuntu\home\me\cli.log'`,
		);
	});

	it("does not shell out to wslpath for URLs", async () => {
		mockWslKernel();
		const open = await freshOpenUrlInBrowser();
		const child = makeChild();
		hoisted.spawnMock.mockImplementation(() => {
			process.nextTick(() => child.emit("spawn"));
			return child;
		});
		await expect(open("https://example.com")).resolves.toBe(true);
		expect(hoisted.execFileSyncMock).not.toHaveBeenCalled();
	});

	it("treats containers on a WSL kernel as plain Linux (xdg-open)", async () => {
		mockWslKernel();
		hoisted.existsSyncMock.mockImplementation(
			(path: string) => path === "/.dockerenv",
		);
		const open = await freshOpenUrlInBrowser();
		const child = makeChild();
		hoisted.spawnMock.mockImplementation(() => {
			process.nextTick(() => child.emit("spawn"));
			return child;
		});
		await expect(open("https://example.com")).resolves.toBe(true);
		expect(hoisted.spawnMock).toHaveBeenCalledTimes(1);
		expect(hoisted.spawnMock.mock.calls[0][0]).toBe("xdg-open");
	});
});
