import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: hoisted.spawnMock }));

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

afterEach(() => {
	hoisted.spawnMock.mockReset();
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
	it("spawns powershell with the URL base64-encoded, never shell-interpolated", async () => {
		const restore = setPlatform("win32");
		try {
			const child = makeChild();
			hoisted.spawnMock.mockReturnValue(child);
			const url = "https://example.com/device?user_code=ABCD-EFGH&x=1";
			const result = openUrlInBrowser(url);
			child.emit("spawn");
			await expect(result).resolves.toBe(true);
			const [command, args] = hoisted.spawnMock.mock.calls[0];
			expect(command).toBe("powershell");
			const encoded = args[args.indexOf("-EncodedCommand") + 1];
			expect(Buffer.from(encoded, "base64").toString("utf16le")).toBe(
				`Start-Process '${url}'`,
			);
			expect(args).not.toContain(url);
		} finally {
			restore();
		}
	});

	it("survives a pre-microtask error on win32 too", async () => {
		const restore = setPlatform("win32");
		try {
			const child = makeChild();
			hoisted.spawnMock.mockReturnValue(child);
			const result = openUrlInBrowser("https://example.com");
			process.nextTick(() => {
				child.emit(
					"error",
					Object.assign(new Error("spawn powershell EPERM"), {
						code: "EPERM",
					}),
				);
			});
			await expect(result).resolves.toBe(false);
		} finally {
			restore();
		}
	});
});
