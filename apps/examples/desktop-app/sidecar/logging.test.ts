import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopLoggerAdapter, DESKTOP_LOG_MAX_BYTES } from "./logging";

const mockOpenSync = vi.hoisted(() => vi.fn());
const realOpenSync = vi.hoisted(() =>
	(require("node:fs") as typeof import("node:fs")).openSync,
);
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		openSync: mockOpenSync,
	};
});

beforeEach(() => {
	mockOpenSync.mockImplementation(realOpenSync);
});

const originalEnv = {
	CLINE_LOG_ENABLED: process.env.CLINE_LOG_ENABLED,
	CLINE_LOG_LEVEL: process.env.CLINE_LOG_LEVEL,
	CLINE_LOG_NAME: process.env.CLINE_LOG_NAME,
	CLINE_LOG_PATH: process.env.CLINE_LOG_PATH,
};

afterEach(() => {
	for (const [key, value] of Object.entries(originalEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("desktop sidecar logging", () => {
	it("writes structured SDK logs to the configured file", () => {
		const directory = mkdtempSync(join(tmpdir(), "cline-code-logging-"));
		const destination = join(directory, "sidecar.log");
		process.env.CLINE_LOG_PATH = destination;
		process.env.CLINE_LOG_LEVEL = "debug";
		delete process.env.CLINE_LOG_ENABLED;

		try {
			const adapter = createDesktopLoggerAdapter();
			adapter.core.debug("desktop runtime event", { sessionId: "session-1" });
			adapter.dispose();

			const contents = readFileSync(destination, "utf8");
			expect(contents).toContain("desktop runtime event");
			expect(contents).toContain('"sessionId":"session-1"');
			expect(adapter.runtimeConfig.name).toBe("cline-code.sidecar");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("warns once before falling back to stderr when the log file cannot open", () => {
		const directory = mkdtempSync(join(tmpdir(), "cline-code-fallback-"));
		process.env.CLINE_LOG_PATH = directory;
		delete process.env.CLINE_LOG_ENABLED;
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		// Force openSync to throw so the fallback path is exercised
		// deterministically on every platform.
		mockOpenSync.mockImplementation(() => {
			const err = new Error(
				"EISDIR: illegal operation on a directory, open",
			);
			(err as Error & { code?: string }).code = "EISDIR";
			throw err;
		});

		try {
			const adapter = createDesktopLoggerAdapter();
			adapter.dispose();

			expect(stderr).toHaveBeenCalledWith(
				expect.stringContaining("Unable to open log file"),
			);
			expect(stderr).toHaveBeenCalledWith(
				expect.stringContaining("falling back to stderr"),
			);
		} finally {
			stderr.mockRestore();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rotates the active log before a write exceeds the size limit", () => {
		const directory = mkdtempSync(join(tmpdir(), "cline-code-rotation-"));
		const destination = join(directory, "sidecar.log");
		process.env.CLINE_LOG_PATH = destination;
		delete process.env.CLINE_LOG_ENABLED;

		try {
			mkdirSync(directory, { recursive: true });
			writeFileSync(destination, "");
			truncateSync(destination, DESKTOP_LOG_MAX_BYTES - 1);
			const adapter = createDesktopLoggerAdapter();
			adapter.core.log("rotate before writing this entry");
			adapter.dispose();

			expect(statSync(destination).size).toBeLessThan(1_024);
			expect(readFileSync(destination, "utf8")).toContain(
				"rotate before writing this entry",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
