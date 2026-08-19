import { describe, expect, it } from "vitest";
import { formatMonitorExitLine } from "../utils/monitor-entry";

describe("formatMonitorExitLine", () => {
	it("is absent while the monitor still runs", () => {
		expect(formatMonitorExitLine(undefined)).toBeUndefined();
	});

	it("attributes user-initiated stops", () => {
		expect(
			formatMonitorExitLine({ status: "stopped", stoppedBy: "user" }),
		).toBe("stopped by you");
		expect(formatMonitorExitLine({ status: "stopped" })).toBe("stopped");
	});

	it("describes failures and exits", () => {
		expect(formatMonitorExitLine({ status: "failed", error: "boom" })).toBe(
			"failed: boom",
		);
		expect(formatMonitorExitLine({ status: "failed" })).toBe("failed");
		expect(formatMonitorExitLine({ status: "exited", code: 2 })).toBe(
			"ended with exit code 2",
		);
		expect(formatMonitorExitLine({ status: "exited" })).toBe("ended");
	});
});
