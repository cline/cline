import { describe, expect, it } from "vitest";
import {
	captureProcessStartTicket,
	killHubProcessBoundToTicket,
	type ProcessStartTicket,
	type ProcReader,
	readLinuxProcessStartTicks,
} from "./process-identity";

const START_TICKS = 4_500_000;

function statLine(startTicks: number, comm = "(node)"): string {
	return `12345 ${comm} S 1 12345 12345 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 11 0 ${startTicks} 1000000 500 18446744073709551615`;
}

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
			if (path.startsWith("/proc/") && path.endsWith("/stat")) {
				return statLine(START_TICKS);
			}
			throw new Error(`ENOENT: ${path}`);
		},
	};
}

const darwinReader: ProcReader = {
	platform: "darwin",
	readFile: () => {
		throw new Error("should not be read");
	},
};

describe("readLinuxProcessStartTicks", () => {
	it("reads field 22 of /proc/<pid>/stat", () => {
		expect(readLinuxProcessStartTicks(12345, linuxReader())).toBe(START_TICKS);
	});

	it("parses past a comm containing spaces and parens", () => {
		// comm is an arbitrary process name: "(tmux: server (2))" is legal, and
		// a first-")" parse would land on the wrong field and misread the tick.
		const reader = linuxReader({
			"/proc/12345/stat": statLine(START_TICKS, "(tmux: server (2))"),
		});
		expect(readLinuxProcessStartTicks(12345, reader)).toBe(START_TICKS);
	});

	it("returns undefined off Linux", () => {
		expect(readLinuxProcessStartTicks(12345, darwinReader)).toBeUndefined();
	});

	it("returns undefined when the process has already exited", () => {
		const reader = linuxReader({ "/proc/12345/stat": undefined });
		expect(readLinuxProcessStartTicks(12345, reader)).toBeUndefined();
	});
});

describe("captureProcessStartTicket", () => {
	it("captures the pid with its exact start tick", () => {
		expect(captureProcessStartTicket(12345, linuxReader())).toEqual({
			pid: 12345,
			startTicks: START_TICKS,
		});
	});

	it("returns undefined off Linux, where identity cannot be proven", () => {
		expect(captureProcessStartTicket(12345, darwinReader)).toBeUndefined();
	});

	it("returns undefined when the process is already gone", () => {
		const reader = linuxReader({ "/proc/12345/stat": undefined });
		expect(captureProcessStartTicket(12345, reader)).toBeUndefined();
	});
});

describe("killHubProcessBoundToTicket", () => {
	const TICKET: ProcessStartTicket = { pid: 12345, startTicks: START_TICKS };

	function recordingKill(failWith?: Partial<Record<string, string>>) {
		const sent: string[] = [];
		return {
			sent,
			kill: (_pid: number, signal: NodeJS.Signals) => {
				const code = failWith?.[signal];
				if (code !== undefined) {
					const error = new Error(code) as Error & { code: string };
					error.code = code;
					throw error;
				}
				sent.push(signal);
			},
		};
	}

	it("freezes, re-reads the tick while frozen, then kills on an exact match", () => {
		// The freeze is the point: a stopped process cannot exit, so the pid
		// cannot be recycled between the /proc read and the kill. The re-read
		// must therefore happen between the two signals.
		const { sent, kill } = recordingKill();
		let readsAfterStop = 0;
		const reader = linuxReader();
		const countingReader: ProcReader = {
			platform: "linux",
			readFile: (path) => {
				if (sent.includes("SIGSTOP")) {
					readsAfterStop += 1;
				}
				return reader.readFile(path);
			},
		};
		const outcome = killHubProcessBoundToTicket(TICKET, {
			reader: countingReader,
			kill,
		});
		expect(outcome).toBe("killed");
		expect(sent).toEqual(["SIGSTOP", "SIGKILL"]);
		expect(readsAfterStop).toBeGreaterThan(0);
	});

	it("thaws and spares a recycled pid — any successor has a different tick", () => {
		// A successor on a recycled pid was created later, at a strictly
		// greater tick, so exact equality cannot pass however fast the pid
		// changed hands. The impostor is frozen, examined, resumed — losing
		// microseconds, not its life.
		const { sent, kill } = recordingKill();
		const reader = linuxReader({
			"/proc/12345/stat": statLine(START_TICKS + 700),
		});
		const outcome = killHubProcessBoundToTicket(TICKET, { reader, kill });
		expect(outcome).toBe("spared");
		expect(sent).toEqual(["SIGSTOP", "SIGCONT"]);
	});

	it("thaws and spares when the process exits before it can be examined", () => {
		const { sent, kill } = recordingKill();
		const reader = linuxReader({ "/proc/12345/stat": undefined });
		const outcome = killHubProcessBoundToTicket(TICKET, { reader, kill });
		expect(outcome).toBe("spared");
		expect(sent).toEqual(["SIGSTOP", "SIGCONT"]);
	});

	it("reports gone when the pid no longer exists at freeze time", () => {
		const { sent, kill } = recordingKill({ SIGSTOP: "ESRCH" });
		const outcome = killHubProcessBoundToTicket(TICKET, {
			reader: linuxReader(),
			kill,
		});
		expect(outcome).toBe("gone");
		expect(sent).toEqual([]);
	});

	it("spares when the pid is not ours to signal", () => {
		const { sent, kill } = recordingKill({ SIGSTOP: "EPERM" });
		const outcome = killHubProcessBoundToTicket(TICKET, {
			reader: linuxReader(),
			kill,
		});
		expect(outcome).toBe("spared");
		expect(sent).toEqual([]);
	});

	it("sends no signals at all off Linux", () => {
		const { sent, kill } = recordingKill();
		const outcome = killHubProcessBoundToTicket(TICKET, {
			reader: darwinReader,
			kill,
		});
		expect(outcome).toBe("spared");
		expect(sent).toEqual([]);
	});
});
