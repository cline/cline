import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	openMock: vi.fn<(url: string, options?: object) => Promise<unknown>>(),
	readFileSyncMock: vi.fn<(path: string, encoding: string) => string>(),
	existsSyncMock: vi.fn<(path: string) => boolean>(),
	accessSyncMock: vi.fn<(path: string, mode?: number) => void>(),
}));

vi.mock("open", () => ({ default: hoisted.openMock }));

vi.mock("node:fs", () => ({
	readFileSync: hoisted.readFileSyncMock,
	existsSync: hoisted.existsSyncMock,
	accessSync: hoisted.accessSyncMock,
	constants: { X_OK: 1 },
}));

import { openUrlInBrowser } from "./open-url";

function setPlatform(platform: NodeJS.Platform): () => void {
	const original = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { value: platform });
	return () => {
		if (original) {
			Object.defineProperty(process, "platform", original);
		}
	};
}

const restores: Array<() => void> = [];
let originalPath: string | undefined;

function usePlatform(platform: NodeJS.Platform): void {
	restores.push(setPlatform(platform));
}

/** Makes exactly the given file paths "executable" for the preflight. */
function mockExecutables(...paths: string[]): void {
	hoisted.accessSyncMock.mockImplementation((path: string) => {
		if (!paths.includes(path)) {
			throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
		}
	});
}

beforeEach(() => {
	originalPath = process.env.PATH;
	process.env.PATH = "/usr/local/bin:/usr/bin";
	// Defaults: not WSL, not a container, no executables anywhere.
	hoisted.readFileSyncMock.mockImplementation(() => {
		throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
	});
	hoisted.existsSyncMock.mockReturnValue(false);
	mockExecutables();
	hoisted.openMock.mockResolvedValue(undefined);
});

afterEach(() => {
	process.env.PATH = originalPath;
	while (restores.length > 0) {
		restores.pop()?.();
	}
	hoisted.openMock.mockReset();
	hoisted.readFileSyncMock.mockReset();
	hoisted.existsSyncMock.mockReset();
	hoisted.accessSyncMock.mockReset();
});

describe("openUrlInBrowser (linux)", () => {
	it("delegates to open() when xdg-open is on PATH", async () => {
		usePlatform("linux");
		mockExecutables("/usr/bin/xdg-open");
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.openMock).toHaveBeenCalledWith("https://example.com", {
			wait: false,
		});
	});

	it("never calls open() when xdg-open is missing — the uncatchable-crash case", async () => {
		// A missing opener binary surfaces as an async `error` event on the
		// detached, listenerless child that open() returns; under Bun it fires
		// before the microtask queue drains, so no try/catch or .catch around
		// open() can intercept it. The preflight must prevent the call.
		usePlatform("linux");
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
		expect(hoisted.openMock).not.toHaveBeenCalled();
	});

	it("resolves false when open() rejects", async () => {
		usePlatform("linux");
		mockExecutables("/usr/bin/xdg-open");
		hoisted.openMock.mockRejectedValue(new Error("boom"));
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
	});

	it("resolves false when open() throws synchronously", async () => {
		usePlatform("linux");
		mockExecutables("/usr/bin/xdg-open");
		hoisted.openMock.mockImplementation(() => {
			throw new Error("boom");
		});
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
	});
});

describe("openUrlInBrowser (darwin / win32)", () => {
	it("skips the preflight on macOS — /usr/bin/open ships with the OS", async () => {
		usePlatform("darwin");
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.openMock).toHaveBeenCalledWith("https://example.com", {
			wait: false,
		});
		expect(hoisted.accessSyncMock).not.toHaveBeenCalled();
	});

	it("skips the preflight on Windows — PowerShell ships with the OS", async () => {
		usePlatform("win32");
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.openMock).toHaveBeenCalled();
		expect(hoisted.accessSyncMock).not.toHaveBeenCalled();
	});
});

describe("openUrlInBrowser (WSL)", () => {
	function mockWslKernel(wslConf?: string): void {
		hoisted.readFileSyncMock.mockImplementation((path: string) => {
			if (path === "/proc/version") {
				return "Linux version 5.15.90.1-microsoft-standard-WSL2";
			}
			if (path === "/etc/wsl.conf" && wslConf !== undefined) {
				return wslConf;
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});
	}

	it("delegates to open() when the mounted PowerShell exists", async () => {
		usePlatform("linux");
		mockWslKernel();
		mockExecutables(
			"/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
		);
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.openMock).toHaveBeenCalled();
	});

	it("never calls open() when Windows interop is unavailable", async () => {
		usePlatform("linux");
		mockWslKernel();
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
		expect(hoisted.openMock).not.toHaveBeenCalled();
	});

	it("honors a custom drive mount root from /etc/wsl.conf", async () => {
		usePlatform("linux");
		mockWslKernel("[automount]\nroot = /custom\n");
		mockExecutables(
			"/custom/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
		);
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.openMock).toHaveBeenCalled();
	});

	it("treats containers on a WSL kernel as plain Linux (xdg-open preflight)", async () => {
		usePlatform("linux");
		mockWslKernel();
		hoisted.existsSyncMock.mockImplementation(
			(path: string) => path === "/.dockerenv",
		);
		mockExecutables("/usr/bin/xdg-open");
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.accessSyncMock).toHaveBeenCalledWith(
			"/usr/bin/xdg-open",
			expect.anything(),
		);
	});
});
