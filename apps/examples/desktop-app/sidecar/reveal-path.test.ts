import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { platformMock, spawnMock } = vi.hoisted(() => ({
	platformMock: vi.fn(),
	spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:os", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:os")>()),
	platform: platformMock,
}));

import { revealPath } from "./reveal-path";

let temporaryDirectory: string;
let filePath: string;

/** A launcher process that reports `events` in order, one microtask apart. */
function launcher(...events: Array<[name: string, value?: unknown]>) {
	const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
	queueMicrotask(() => {
		for (const [name, value] of events) child.emit(name, value);
	});
	return child;
}

const detached = { stdio: "ignore", detached: true, windowsHide: true };

beforeEach(async () => {
	temporaryDirectory = await mkdtemp(join(tmpdir(), "cline-reveal-path-"));
	filePath = join(temporaryDirectory, "a file; $(echo hello).md");
	await writeFile(filePath, "example");
	platformMock.mockReturnValue("darwin");
	spawnMock.mockImplementation(() => launcher(["spawn"], ["exit", 0]));
});

afterEach(async () => {
	vi.clearAllMocks();
	await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("revealPath", () => {
	it("reveals a file in Finder, preserving spaces and shell syntax as one path argument", async () => {
		await revealPath(filePath);

		expect(spawnMock).toHaveBeenCalledWith("open", ["-R", filePath], {
			...detached,
			windowsVerbatimArguments: undefined,
		});
	});

	it("selects the path in Windows Explorer, quoting it against spaces and commas", async () => {
		platformMock.mockReturnValue("win32");
		// Explorer reports success by handing off, often with a nonzero code.
		spawnMock.mockImplementation(() => launcher(["spawn"], ["exit", 1]));
		await revealPath(filePath);

		expect(spawnMock).toHaveBeenCalledWith(
			"explorer.exe",
			[`/select,"${win32.normalize(filePath)}"`],
			{ ...detached, windowsVerbatimArguments: true },
		);
		expect(win32.normalize(filePath)).not.toContain("/");
	});

	it("reports an Explorer launch failure", async () => {
		platformMock.mockReturnValue("win32");
		spawnMock.mockImplementation(() =>
			launcher(["error", new Error("spawn failed")]),
		);

		await expect(revealPath(filePath)).rejects.toThrow(
			"Could not open file location: spawn failed",
		);
	});

	it("opens a file's containing directory on Linux", async () => {
		platformMock.mockReturnValue("linux");
		await revealPath(filePath);

		expect(spawnMock).toHaveBeenCalledWith("xdg-open", [temporaryDirectory], {
			...detached,
			windowsVerbatimArguments: undefined,
		});
	});

	it("opens directories in the Linux file manager", async () => {
		platformMock.mockReturnValue("linux");
		const directoryPath = join(temporaryDirectory, "plugin");
		await mkdir(directoryPath);
		await revealPath(directoryPath);

		expect(spawnMock).toHaveBeenCalledWith(
			"xdg-open",
			[directoryPath],
			expect.anything(),
		);
	});

	it("does not wait for a launcher that keeps running in the foreground", async () => {
		platformMock.mockReturnValue("linux");
		const child = launcher(["spawn"]);
		spawnMock.mockImplementation(() => child);
		let settled = false;
		const revealed = revealPath(filePath).then(() => {
			settled = true;
		});
		await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
		// Spawned but still running: the caller is released after a short grace
		// period rather than when the file manager eventually closes.
		expect(settled).toBe(false);
		await revealed;
		expect(child.unref).toHaveBeenCalledOnce();
	}, 5_000);

	it.each([
		undefined,
		null,
		"",
		"   ",
		42,
		"relative.md",
		"https://example.com",
		"/tmp/invalid\0path",
	])("rejects invalid path %j without launching a process", async (path) => {
		await expect(revealPath(path)).rejects.toThrow(/path/);
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("reports missing paths without launching a process", async () => {
		await expect(
			revealPath(join(temporaryDirectory, "missing.md")),
		).rejects.toThrow("Path not found or inaccessible");
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("reports a file manager that exits with an error", async () => {
		spawnMock.mockImplementation(() => launcher(["spawn"], ["exit", 1]));

		await expect(revealPath(filePath)).rejects.toThrow(
			"Could not open file location: open exited with code 1",
		);
	});
});
