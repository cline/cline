import { describe, expect, it } from "vitest";
import { runningMonitors } from "@/lib/session-monitors";

describe("runningMonitors", () => {
	it("keeps only running monitors with valid identity", () => {
		expect(
			runningMonitors([
				{ id: "mon_1", name: "ci", status: "running" },
				{ id: "mon_2", name: "old", status: "exited" },
				{ id: "mon_3", name: "halted", status: "stopped" },
				{ id: "mon_4", name: "broken", status: "failed" },
			]),
		).toEqual([{ id: "mon_1", name: "ci" }]);
	});

	it("drops malformed records instead of rendering them", () => {
		expect(
			runningMonitors([
				{ id: 7, name: "bad-id", status: "running" },
				{ id: "mon_2", name: undefined, status: "running" },
				{ id: "mon_3", name: "ok", status: "running" },
				null as never,
			]),
		).toEqual([{ id: "mon_3", name: "ok" }]);
	});

	it("returns an empty roster for missing or non-array payloads", () => {
		expect(runningMonitors(undefined)).toEqual([]);
		expect(runningMonitors("nope" as never)).toEqual([]);
	});
});
