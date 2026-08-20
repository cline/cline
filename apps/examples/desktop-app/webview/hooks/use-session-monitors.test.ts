import { describe, expect, it } from "vitest";
import {
	monitorSuppressionKey,
	parseRunningMonitors,
	pruneMonitorSuppressions,
} from "@/hooks/use-session-monitors";

function record(overrides: Record<string, unknown> = {}) {
	return {
		id: "mon_1",
		name: "ci",
		description: "CI status",
		command: "gh pr checks --watch",
		startedAt: 1,
		status: "running",
		linesEmitted: 3,
		...overrides,
	};
}

describe("parseRunningMonitors", () => {
	it("keeps only running monitors", () => {
		expect(
			parseRunningMonitors([
				record(),
				record({ id: "mon_2", name: "old", status: "exited" }),
				record({ id: "mon_3", name: "halted", status: "stopped" }),
			]),
		).toEqual([{ id: "mon_1", name: "ci" }]);
	});

	it("drops malformed records instead of throwing", () => {
		expect(
			parseRunningMonitors([
				null,
				42,
				"text",
				{ status: "running" },
				record({ id: 7 }),
				record({ name: undefined }),
				record({ id: "mon_9", name: "good" }),
			]),
		).toEqual([{ id: "mon_9", name: "good" }]);
	});

	it("reports nothing for non-array payloads", () => {
		expect(parseRunningMonitors(undefined)).toEqual([]);
		expect(parseRunningMonitors({})).toEqual([]);
		expect(parseRunningMonitors("mon_1")).toEqual([]);
	});
});

describe("pruneMonitorSuppressions", () => {
	it("keeps a suppression while the stopped monitor is still in the roster", () => {
		const suppressed = new Set([monitorSuppressionKey("session_1", "mon_1")]);
		expect(
			pruneMonitorSuppressions(
				suppressed,
				[{ id: "mon_1", name: "ci" }],
				"session_1",
			),
		).toBe(suppressed);
	});

	it("drops a suppression once the snapshot removes the monitor", () => {
		expect(
			pruneMonitorSuppressions(
				new Set([monitorSuppressionKey("session_1", "mon_1")]),
				[],
				"session_1",
			),
		).toEqual(new Set());
	});

	it("does not let a stale suppression hide a reused monitor id", () => {
		// User stops mon_1, the snapshot settles, and a rebuilt runtime later
		// hands out mon_1 again to a different monitor: the new monitor shows.
		let suppressed = new Set([monitorSuppressionKey("session_1", "mon_1")]);
		suppressed = pruneMonitorSuppressions(suppressed, [], "session_1");
		expect(suppressed.has(monitorSuppressionKey("session_1", "mon_1"))).toBe(
			false,
		);
	});

	it("leaves other sessions' suppressions alone", () => {
		const otherKey = monitorSuppressionKey("session_2", "mon_1");
		expect(
			pruneMonitorSuppressions(new Set([otherKey]), [], "session_1"),
		).toEqual(new Set([otherKey]));
	});
});
