import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopLoggerAdapter } from "./logging";

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
});
