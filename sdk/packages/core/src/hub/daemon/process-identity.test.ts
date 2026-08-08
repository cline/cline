import { describe, expect, it } from "vitest";
import {
	hubProcessStartMatchesReport,
	type ProcReader,
	readLinuxProcessStartWallClockMs,
} from "./process-identity";

const BOOT_SECONDS = 1_754_000_000;
// starttime ticks are USER_HZ (100/s): 4_500_000 ticks = 45_000s after boot.
const START_TICKS = 4_500_000;
const PROCESS_START_MS = BOOT_SECONDS * 1_000 + START_TICKS * 10;

function linuxReader(
	overrides: Partial<Record<string, string>> = {},
): ProcReader {
	return {
		platform: "linux",
		readFile: (path: string) => {
			if (path in overrides) {
				const value = overrides[path];
				if (value === undefined) {
					throw new Error(`ENOENT: ${path}`);
				}
				return value;
			}
			if (path === "/proc/stat") {
				return `cpu  1 2 3 4\nbtime ${BOOT_SECONDS}\nprocesses 999\n`;
			}
			if (path.startsWith("/proc/") && path.endsWith("/stat")) {
				return `12345 (node) S 1 12345 12345 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 11 0 ${START_TICKS} 1000000 500 18446744073709551615`;
			}
			throw new Error(`ENOENT: ${path}`);
		},
	};
}

describe("readLinuxProcessStartWallClockMs", () => {
	it("converts starttime ticks anchored at boot time into wall-clock ms", () => {
		expect(readLinuxProcessStartWallClockMs(12345, linuxReader())).toBe(
			PROCESS_START_MS,
		);
	});

	it("parses past a comm containing spaces and parens", () => {
		// comm is an arbitrary process name: "(tmux: server)" is legal, and a
		// first-")" parse would land on the wrong field and misread starttime.
		const reader = linuxReader({
			"/proc/12345/stat": `12345 (tmux: server (2)) S 1 12345 12345 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 11 0 ${START_TICKS} 1000000 500 18446744073709551615`,
		});
		expect(readLinuxProcessStartWallClockMs(12345, reader)).toBe(
			PROCESS_START_MS,
		);
	});

	it("returns undefined off Linux", () => {
		const reader: ProcReader = {
			platform: "darwin",
			readFile: () => {
				throw new Error("should not be read");
			},
		};
		expect(readLinuxProcessStartWallClockMs(12345, reader)).toBeUndefined();
	});

	it("returns undefined when the process has already exited", () => {
		const reader = linuxReader({ "/proc/12345/stat": undefined });
		expect(readLinuxProcessStartWallClockMs(12345, reader)).toBeUndefined();
	});

	it("returns undefined when btime is missing", () => {
		const reader = linuxReader({ "/proc/stat": "cpu  1 2 3 4\n" });
		expect(readLinuxProcessStartWallClockMs(12345, reader)).toBeUndefined();
	});
});

describe("hubProcessStartMatchesReport", () => {
	it("confirms a process that started before its reported listen time", () => {
		// Normal case: the daemon booted, loaded modules, then began serving.
		const startedAt = new Date(PROCESS_START_MS + 1_500).toISOString();
		expect(hubProcessStartMatchesReport(12345, startedAt, linuxReader())).toBe(
			true,
		);
	});

	it("rejects a process younger than the report — a recycled pid", () => {
		// An impostor can only exist because the reporting daemon died after
		// answering, so the impostor's start is always later than startedAt.
		const startedAt = new Date(PROCESS_START_MS - 10_000).toISOString();
		expect(hubProcessStartMatchesReport(12345, startedAt, linuxReader())).toBe(
			false,
		);
	});

	it("rejects when the report carries no startedAt", () => {
		expect(hubProcessStartMatchesReport(12345, undefined, linuxReader())).toBe(
			false,
		);
	});

	it("rejects when startedAt is unparsable", () => {
		expect(
			hubProcessStartMatchesReport(12345, "not-a-date", linuxReader()),
		).toBe(false);
	});

	it("rejects off Linux, where identity cannot be proven", () => {
		const reader: ProcReader = {
			platform: "darwin",
			readFile: () => {
				throw new Error("should not be read");
			},
		};
		expect(
			hubProcessStartMatchesReport(
				12345,
				new Date(PROCESS_START_MS).toISOString(),
				reader,
			),
		).toBe(false);
	});
});
