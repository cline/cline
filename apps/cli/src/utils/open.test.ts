import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	realOpenMock: vi.fn<(url: string, options?: object) => Promise<unknown>>(),
	readFileSyncMock: vi.fn<(path: string, encoding: string) => string>(),
	accessSyncMock: vi.fn<(path: string, mode?: number) => void>(),
}));

vi.mock("open", () => ({ default: hoisted.realOpenMock }));

vi.mock("node:fs", () => ({
	readFileSync: hoisted.readFileSyncMock,
	accessSync: hoisted.accessSyncMock,
	constants: { X_OK: 1 },
}));

import open from "./open";

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

/** Makes exactly the given file paths "executable". */
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
	// Defaults: not WSL, no executables anywhere.
	hoisted.readFileSyncMock.mockImplementation(() => {
		throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
	});
	mockExecutables();
	hoisted.realOpenMock.mockResolvedValue(undefined);
});

afterEach(() => {
	process.env.PATH = originalPath;
	while (restores.length > 0) {
		restores.pop()?.();
	}
	hoisted.realOpenMock.mockReset();
	hoisted.readFileSyncMock.mockReset();
	hoisted.accessSyncMock.mockReset();
});

describe("open wrapper (linux)", () => {
	it("passes through untouched when xdg-open is on PATH", async () => {
		usePlatform("linux");
		mockExecutables("/usr/bin/xdg-open");
		await open("https://example.com", { wait: false });
		expect(hoisted.realOpenMock).toHaveBeenCalledWith("https://example.com", {
			wait: false,
		});
	});

	it("falls back to a packaged xdg-open script when PATH has none", async () => {
		usePlatform("linux");
		process.env.PATH = "/nowhere";
		// e.g. an xdg-open placed next to the executable.
		const packaged = join(dirname(process.execPath), "xdg-open");
		mockExecutables(packaged);
		await open("https://example.com", { wait: false });
		expect(hoisted.realOpenMock).toHaveBeenCalledWith("https://example.com", {
			wait: false,
			app: { name: packaged },
		});
	});

	it("rejects without calling open() when no xdg-open exists anywhere — the uncatchable-crash case", async () => {
		// A missing opener binary surfaces as an async `error` event on the
		// detached, listenerless child that open() returns; under Bun it fires
		// before the microtask queue drains, so no try/catch or .catch around
		// open() can intercept it. The wrapper must reject before open() ever
		// spawns, so the call sites' existing .catch fallbacks handle it.
		usePlatform("linux");
		await expect(open("https://example.com", { wait: false })).rejects.toThrow(
			"xdg-open is not available",
		);
		expect(hoisted.realOpenMock).not.toHaveBeenCalled();
	});

	it("skips the fallback on WSL, where open uses powershell.exe", async () => {
		usePlatform("linux");
		hoisted.readFileSyncMock.mockReturnValue(
			"Linux version 5.15.90.1-microsoft-standard-WSL2",
		);
		await open("https://example.com", { wait: false });
		expect(hoisted.realOpenMock).toHaveBeenCalledWith("https://example.com", {
			wait: false,
		});
	});

	it("never interferes when the caller specifies an app explicitly", async () => {
		usePlatform("linux");
		const options = { wait: false, app: { name: "firefox" } };
		await open("https://example.com", options);
		expect(hoisted.realOpenMock).toHaveBeenCalledWith(
			"https://example.com",
			options,
		);
		expect(hoisted.accessSyncMock).not.toHaveBeenCalled();
	});
});

describe("open wrapper (other platforms)", () => {
	it("passes through untouched on macOS", async () => {
		usePlatform("darwin");
		await open("https://example.com", { wait: false });
		expect(hoisted.realOpenMock).toHaveBeenCalledWith("https://example.com", {
			wait: false,
		});
		expect(hoisted.accessSyncMock).not.toHaveBeenCalled();
	});

	it("passes through untouched on Windows", async () => {
		usePlatform("win32");
		await open("https://example.com", { wait: false });
		expect(hoisted.realOpenMock).toHaveBeenCalledWith("https://example.com", {
			wait: false,
		});
		expect(hoisted.accessSyncMock).not.toHaveBeenCalled();
	});
});
