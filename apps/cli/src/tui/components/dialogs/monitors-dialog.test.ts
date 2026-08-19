import { describe, expect, it, vi } from "vitest";
import type { MonitorItem } from "../../types";

vi.mock("@opentui-ui/dialog/react", () => ({
	useDialogKeyboard: () => undefined,
}));

import {
	getMonitorRowColor,
	getMonitorStatusLabel,
	getMonitorsFooterText,
	markMonitorStopped,
} from "./monitors-dialog";

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

describe("getMonitorsFooterText", () => {
	it("offers stop only when something is running", () => {
		expect(getMonitorsFooterText(true)).toBe(
			"Space to stop selected, Esc to go back",
		);
		expect(getMonitorsFooterText(false)).toBe("Esc to go back");
	});
});

describe("getMonitorStatusLabel", () => {
	it("labels each lifecycle state", () => {
		expect(getMonitorStatusLabel(makeMonitor())).toBe("running");
		expect(getMonitorStatusLabel(makeMonitor({ status: "stopped" }))).toBe(
			"stopped",
		);
		expect(getMonitorStatusLabel(makeMonitor({ status: "failed" }))).toBe(
			"failed",
		);
		expect(
			getMonitorStatusLabel(makeMonitor({ status: "exited", exitCode: 1 })),
		).toBe("exited (1)");
		expect(getMonitorStatusLabel(makeMonitor({ status: "exited" }))).toBe(
			"exited",
		);
	});
});

describe("getMonitorRowColor", () => {
	it("keeps failure and running colors regardless of selection", () => {
		expect(getMonitorRowColor(makeMonitor({ status: "failed" }), true)).toBe(
			getMonitorRowColor(makeMonitor({ status: "failed" }), false),
		);
		expect(getMonitorRowColor(makeMonitor(), true)).toBe(
			getMonitorRowColor(makeMonitor(), false),
		);
	});

	it("distinguishes selected terminal rows", () => {
		expect(
			getMonitorRowColor(makeMonitor({ status: "stopped" }), true),
		).not.toBe(getMonitorRowColor(makeMonitor({ status: "stopped" }), false));
	});
});

describe("markMonitorStopped", () => {
	it("stops only the matching running monitor", () => {
		const monitors = [
			makeMonitor(),
			makeMonitor({ id: "mon_2", status: "exited" }),
		];
		const next = markMonitorStopped(monitors, "mon_1");
		expect(next[0]?.status).toBe("stopped");
		expect(next[1]?.status).toBe("exited");
	});

	it("leaves already-terminal monitors untouched", () => {
		const monitors = [makeMonitor({ status: "exited", exitCode: 0 })];
		expect(markMonitorStopped(monitors, "mon_1")).toEqual(monitors);
	});
});
