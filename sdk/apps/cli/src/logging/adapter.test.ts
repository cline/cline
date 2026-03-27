import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCliBuildInfo } from "../utils/common";
import {
	createCliLoggerAdapter,
	flushCliLoggerAdapters,
	shutdownCliLoggerAdapters,
} from "./adapter";

const envKeys = [
	"CLINE_DATA_DIR",
	"CLINE_LOG_PATH",
	"CLINE_LOG_LEVEL",
	"CLINE_LOG_NAME",
	"CLINE_LOG_ENABLED",
] as const;

function withEnvSnapshot(): Record<
	(typeof envKeys)[number],
	string | undefined
> {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_LOG_PATH: process.env.CLINE_LOG_PATH,
		CLINE_LOG_LEVEL: process.env.CLINE_LOG_LEVEL,
		CLINE_LOG_NAME: process.env.CLINE_LOG_NAME,
		CLINE_LOG_ENABLED: process.env.CLINE_LOG_ENABLED,
	};
}

function restoreEnv(
	snapshot: Record<(typeof envKeys)[number], string | undefined>,
): void {
	for (const key of envKeys) {
		const value = snapshot[key];
		if (value === undefined) {
			delete process.env[key];
			continue;
		}
		process.env[key] = value;
	}
}

const commandName = getCliBuildInfo().name;

describe("createCliLoggerAdapter", () => {
	afterEach(() => {
		shutdownCliLoggerAdapters();
		vi.restoreAllMocks();
	});

	it("resolves default runtime config from data dir", () => {
		const snapshot = withEnvSnapshot();
		const dataDir = mkdtempSync(join(tmpdir(), `${commandName}-log-test-`));
		process.env.CLINE_DATA_DIR = dataDir;
		delete process.env.CLINE_LOG_PATH;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		try {
			const adapter = createCliLoggerAdapter({ runtime: "cli" });
			expect(adapter.runtimeConfig.destination).toBe(
				join(dataDir, "logs", `${commandName}.log`),
			);
			expect(adapter.runtimeConfig.level).toBe("info");
			expect(adapter.runtimeConfig.name).toBe(`${commandName}.cli`);
			expect(adapter.runtimeConfig.enabled).toBe(true);
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("uses provided runtime config in rpc runtime", () => {
		const adapter = createCliLoggerAdapter({
			runtime: "rpc-runtime",
			runtimeConfig: {
				destination: "/tmp/custom-runtime.log",
				level: "warn",
				name: "custom-runtime",
				enabled: false,
			},
		});

		expect(adapter.runtimeConfig.destination).toBe("/tmp/custom-runtime.log");
		expect(adapter.runtimeConfig.level).toBe("warn");
		expect(adapter.runtimeConfig.name).toBe("custom-runtime");
		expect(adapter.runtimeConfig.enabled).toBe(false);
	});

	it("maps core logger metadata with error payload", () => {
		const dataDir = mkdtempSync(join(tmpdir(), `${commandName}-log-test-`));
		const snapshot = withEnvSnapshot();
		process.env.CLINE_DATA_DIR = dataDir;
		process.env.CLINE_LOG_ENABLED = "0";
		try {
			const adapter = createCliLoggerAdapter({ runtime: "cli" });
			expect(() => {
				adapter.core.error?.("runtime error", {
					error: new Error("boom"),
					sessionId: "s1",
				});
			}).not.toThrow();
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("truncates stale log files older than two days on startup", () => {
		const snapshot = withEnvSnapshot();
		const dataDir = mkdtempSync(join(tmpdir(), `${commandName}-log-test-`));
		const logPath = join(dataDir, "logs", `${commandName}.log`);
		process.env.CLINE_DATA_DIR = dataDir;
		delete process.env.CLINE_LOG_PATH;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		try {
			mkdirSync(dirname(logPath), { recursive: true });
			writeFileSync(logPath, "old log contents", "utf8");
			const staleDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
			utimesSync(logPath, staleDate, staleDate);

			createCliLoggerAdapter({ runtime: "cli" });
			expect(readFileSync(logPath, "utf8")).toBe("");
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("falls back when log destination path is not writable", () => {
		const snapshot = withEnvSnapshot();
		const unwritablePath = mkdtempSync(
			join(tmpdir(), `${commandName}-log-dir-as-file-`),
		);
		delete process.env.CLINE_DATA_DIR;
		process.env.CLINE_LOG_PATH = unwritablePath;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		try {
			expect(() => {
				const adapter = createCliLoggerAdapter({ runtime: "cli" });
				adapter.core.info?.("fallback path test");
			}).not.toThrow();
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("uses a sync stderr fallback for cli runtime", () => {
		const snapshot = withEnvSnapshot();
		const unwritablePath = mkdtempSync(
			join(tmpdir(), `${commandName}-log-dir-as-file-`),
		);
		delete process.env.CLINE_DATA_DIR;
		process.env.CLINE_LOG_PATH = unwritablePath;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		const destinationSpy = vi.spyOn(pino, "destination");
		try {
			createCliLoggerAdapter({ runtime: "cli" });
			expect(destinationSpy.mock.calls).toContainEqual([
				expect.objectContaining({
					dest: 2,
					sync: true,
				}),
			]);
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("uses sync pino destination for cli runtime", () => {
		const snapshot = withEnvSnapshot();
		const dataDir = mkdtempSync(join(tmpdir(), `${commandName}-log-test-`));
		process.env.CLINE_DATA_DIR = dataDir;
		delete process.env.CLINE_LOG_PATH;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		const destinationSpy = vi.spyOn(pino, "destination");
		try {
			createCliLoggerAdapter({ runtime: "cli" });
			expect(destinationSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					sync: true,
				}),
			);
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("flushes immediate-shutdown logs without sonic-boom readiness errors", () => {
		const snapshot = withEnvSnapshot();
		const dataDir = mkdtempSync(
			join(tmpdir(), `${commandName}-shutdown-test-`),
		);
		process.env.CLINE_DATA_DIR = dataDir;
		delete process.env.CLINE_LOG_PATH;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		try {
			const adapter = createCliLoggerAdapter({
				runtime: "cli",
				component: "shutdown-test",
			});
			expect(() => {
				adapter.core.info?.("immediate shutdown");
				flushCliLoggerAdapters();
			}).not.toThrowError(/sonic boom is not ready yet/);

			const logPath = join(dataDir, "logs", `${commandName}.log`);
			expect(readFileSync(logPath, "utf8")).toContain("immediate shutdown");
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("keeps normal logging behavior with explicit flush", () => {
		const snapshot = withEnvSnapshot();
		const dataDir = mkdtempSync(join(tmpdir(), `${commandName}-flush-test-`));
		process.env.CLINE_DATA_DIR = dataDir;
		delete process.env.CLINE_LOG_PATH;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		try {
			const adapter = createCliLoggerAdapter({
				runtime: "cli",
				component: "flush-test",
			});
			adapter.core.info?.("normal logging");
			expect(() => flushCliLoggerAdapters()).not.toThrow();

			const logPath = join(dataDir, "logs", `${commandName}.log`);
			expect(readFileSync(logPath, "utf8")).toContain("normal logging");
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("closes cli loggers cleanly during shutdown", async () => {
		const snapshot = withEnvSnapshot();
		const dataDir = mkdtempSync(join(tmpdir(), `${commandName}-close-test-`));
		process.env.CLINE_DATA_DIR = dataDir;
		delete process.env.CLINE_LOG_PATH;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		try {
			const adapter = createCliLoggerAdapter({
				runtime: "cli",
				component: "close-test",
			});
			adapter.core.info?.("shutdown logging");

			expect(() => shutdownCliLoggerAdapters()).not.toThrow();

			const logPath = join(dataDir, "logs", `${commandName}.log`);
			expect(readFileSync(logPath, "utf8")).toContain("shutdown logging");
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("clears log cleanup timers during shutdown", () => {
		const snapshot = withEnvSnapshot();
		const dataDir = mkdtempSync(join(tmpdir(), `${commandName}-timer-test-`));
		process.env.CLINE_DATA_DIR = dataDir;
		delete process.env.CLINE_LOG_PATH;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
		try {
			createCliLoggerAdapter({
				runtime: "cli",
				component: "timer-test",
			});

			shutdownCliLoggerAdapters();

			expect(clearIntervalSpy).toHaveBeenCalled();
		} finally {
			clearIntervalSpy.mockRestore();
			restoreEnv(snapshot);
		}
	});
});
