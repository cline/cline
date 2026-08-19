import { describe, expect, it } from "vitest";
import { parseRunningMonitors } from "@/hooks/use-session-monitors";

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
