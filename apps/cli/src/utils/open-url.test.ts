import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	openMock: vi.fn(),
}));

vi.mock("open", () => ({ default: hoisted.openMock }));

import { openUrlInBrowser } from "./open-url";

function flushToListeners(): Promise<void> {
	// openUrlInBrowser awaits open() before attaching listeners; give it a
	// macrotask so emits below can't fire on a listenerless emitter.
	return new Promise((resolve) => setImmediate(resolve));
}

describe("openUrlInBrowser", () => {
	it("resolves true when the opener process spawns", async () => {
		const child = new EventEmitter();
		hoisted.openMock.mockResolvedValue(child);
		const result = openUrlInBrowser("https://example.com");
		await flushToListeners();
		child.emit("spawn");
		await expect(result).resolves.toBe(true);
	});

	it("resolves false when the opener binary is missing", async () => {
		// A missing opener (e.g. xdg-open on headless Linux) surfaces as an
		// async `error` event on the detached child, not as a rejection from
		// open() — previously this became a fatal uncaughtException.
		const child = new EventEmitter();
		hoisted.openMock.mockResolvedValue(child);
		const result = openUrlInBrowser("https://example.com");
		await flushToListeners();
		child.emit(
			"error",
			Object.assign(new Error('Executable not found in $PATH: "xdg-open"'), {
				code: "ENOENT",
			}),
		);
		await expect(result).resolves.toBe(false);
	});

	it("resolves false when open() itself rejects", async () => {
		hoisted.openMock.mockRejectedValue(new Error("spawn failure"));
		await expect(openUrlInBrowser("https://example.com")).resolves.toBe(false);
	});
});
