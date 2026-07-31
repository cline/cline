import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	openMock: vi.fn<(url: string, options?: object) => Promise<unknown>>(),
	readFileSyncMock: vi.fn<(path: string, encoding: string) => string>(),
	accessSyncMock: vi.fn<(path: string, mode?: number) => void>(),
}));

vi.mock("open", () => ({ default: hoisted.openMock }));

vi.mock("node:fs", () => ({
	readFileSync: hoisted.readFileSyncMock,
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

function mockXdgOpenPresent(present: boolean): void {
	hoisted.accessSyncMock.mockImplementation((path: string) => {
		if (!(present && path.endsWith("/xdg-open"))) {
			throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
		}
	});
}

beforeEach(() => {
	originalPath = process.env.PATH;
	process.env.PATH = "/usr/local/bin:/usr/bin";
	// Defaults: not WSL, no xdg-open anywhere.
	hoisted.readFileSyncMock.mockImplementation(() => {
		throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
	});
	mockXdgOpenPresent(false);
	hoisted.openMock.mockResolvedValue(undefined);
});

afterEach(() => {
	process.env.PATH = originalPath;
	while (restores.length > 0) {
		restores.pop()?.();
	}
	hoisted.openMock.mockReset();
	hoisted.readFileSyncMock.mockReset();
	hoisted.accessSyncMock.mockReset();
});

describe("openUrlInBrowser (linux)", () => {
	it("delegates to open() when xdg-open is on PATH", async () => {
		usePlatform("linux");
		mockXdgOpenPresent(true);
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.openMock).toHaveBeenCalledWith("https://example.com", {
			wait: false,
		});
	});

	it("never calls open() when xdg-open is missing — the uncatchable-crash case", async () => {
		// A missing opener binary surfaces as an async `error` event on the
		// detached, listenerless child that open() returns; under Bun it fires
		// before the microtask queue drains, so no try/catch or .catch around
		// open() can intercept it. The check must prevent the call entirely.
		usePlatform("linux");
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
		expect(hoisted.openMock).not.toHaveBeenCalled();
	});

	it("skips the xdg-open check on WSL, where open uses powershell.exe", async () => {
		usePlatform("linux");
		hoisted.readFileSyncMock.mockReturnValue(
			"Linux version 5.15.90.1-microsoft-standard-WSL2",
		);
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.openMock).toHaveBeenCalled();
		expect(hoisted.accessSyncMock).not.toHaveBeenCalled();
	});

	it("resolves false when open() rejects", async () => {
		usePlatform("linux");
		mockXdgOpenPresent(true);
		hoisted.openMock.mockRejectedValue(new Error("boom"));
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
	});

	it("resolves false when open() throws synchronously", async () => {
		usePlatform("linux");
		mockXdgOpenPresent(true);
		hoisted.openMock.mockImplementation(() => {
			throw new Error("boom");
		});
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
	});
});

describe("openUrlInBrowser (other platforms)", () => {
	it("delegates unconditionally on macOS", async () => {
		usePlatform("darwin");
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.openMock).toHaveBeenCalledWith("https://example.com", {
			wait: false,
		});
		expect(hoisted.accessSyncMock).not.toHaveBeenCalled();
	});

	it("delegates unconditionally on Windows", async () => {
		usePlatform("win32");
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(true);
		expect(hoisted.openMock).toHaveBeenCalled();
		expect(hoisted.accessSyncMock).not.toHaveBeenCalled();
	});
});
