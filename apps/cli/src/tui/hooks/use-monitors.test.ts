import { describe, expect, it } from "vitest";
import type { MonitorItem } from "../types";
import {
	countRunningMonitors,
	formatMonitorListRow,
	formatMonitorStatusText,
	formatMonitorUptime,
	toMonitorItems,
} from "./use-monitors";

function makeMonitor(overrides: Partial<MonitorItem> = {}): MonitorItem {
	return {
		id: "mon_1",
		name: "applog",
		description: "watching the app log",
		command: "tail -F app.log",
		startedAt: 0,
		status: "running",
		linesEmitted: 0,
		...overrides,
	};
}

describe("toMonitorItems", () => {
	it("maps a snapshot into roster items", () => {
		const items = toMonitorItems({
			sessionId: "session-1",
			monitors: [
				{
					id: "mon_1",
					name: "ci",
					description: "CI status",
					command: "watch ci",
					startedAt: 123,
					status: "running",
					linesEmitted: 4,
				},
			],
		});
		expect(items).toEqual([
			expect.objectContaining({
				id: "mon_1",
				name: "ci",
				status: "running",
				linesEmitted: 4,
			}),
		]);
	});
});

describe("formatMonitorStatusText", () => {
	it("is empty with no running monitors", () => {
		expect(formatMonitorStatusText([])).toBe("");
		expect(formatMonitorStatusText([makeMonitor({ status: "exited" })])).toBe(
			"",
		);
	});

	it("counts only running monitors and pluralizes", () => {
		expect(formatMonitorStatusText([makeMonitor()])).toBe("◉ 1 monitor");
		expect(
			formatMonitorStatusText([
				makeMonitor(),
				makeMonitor({ id: "mon_2" }),
				makeMonitor({ id: "mon_3", status: "stopped" }),
			]),
		).toBe("◉ 2 monitors");
	});
});

describe("countRunningMonitors", () => {
	it("ignores terminal statuses", () => {
		expect(
			countRunningMonitors([
				makeMonitor(),
				makeMonitor({ id: "mon_2", status: "failed" }),
				makeMonitor({ id: "mon_3", status: "exited" }),
			]),
		).toBe(1);
	});
});

describe("formatMonitorUptime", () => {
	it("formats seconds, minutes, and hours", () => {
		expect(formatMonitorUptime(0, 5_000)).toBe("5s");
		expect(formatMonitorUptime(0, 65_000)).toBe("1m 5s");
		expect(formatMonitorUptime(0, 3_660_000)).toBe("1h 1m");
	});

	it("never goes negative on clock skew", () => {
		expect(formatMonitorUptime(10_000, 5_000)).toBe("0s");
	});
});

describe("formatMonitorListRow", () => {
	it("shows uptime for running monitors", () => {
		expect(formatMonitorListRow(makeMonitor(), 65_000)).toBe(
			"applog [running 1m 5s] 0 lines — watching the app log",
		);
	});

	it("shows terminal status and singular line count", () => {
		expect(
			formatMonitorListRow(
				makeMonitor({ status: "stopped", linesEmitted: 1 }),
				65_000,
			),
		).toBe("applog [stopped] 1 line — watching the app log");
	});
});
