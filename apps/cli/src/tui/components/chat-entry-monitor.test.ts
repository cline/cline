import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { hydrateSessionMessages } from "../utils/hydrate-messages";
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
		expect(formatMonitorExitLine({ status: "exited", signal: "SIGTERM" })).toBe(
			"ended on signal SIGTERM",
		);
	});
});

describe("hydrating persisted monitor steer messages", () => {
	const fencedText =
		'<user_input mode="act">Background monitor "ci" (CI status) produced new output.\n<monitor-output>\nbuild failed\n</monitor-output></user_input>';

	function monitorMessage(
		metadata: Record<string, unknown>,
	): MessageWithMetadata {
		return {
			role: "user",
			content: [{ type: "text", text: fencedText }],
			ts: 1,
			metadata,
		};
	}

	it("renders cards from persisted origin metadata instead of the fence", () => {
		const entries = hydrateSessionMessages([
			monitorMessage({
				userRunSpan: 0,
				monitorOrigin: {
					kind: "monitor",
					droppedUpdates: 3,
					updates: [
						{
							monitorId: "mon_1",
							name: "ci",
							description: "CI status",
							lines: ["build failed"],
							droppedLines: 2,
							exit: { status: "exited", code: 1 },
						},
						{
							monitorId: "mon_1",
							name: "ci",
							description: "CI status",
							lines: ["retrying"],
						},
					],
				},
			}),
		]);

		expect(entries).toEqual([
			{
				kind: "monitor_update",
				name: "ci",
				description: "CI status",
				lines: ["build failed"],
				droppedLines: 2,
				omittedEarlierUpdates: 3,
				exit: {
					status: "exited",
					stoppedBy: undefined,
					code: 1,
					signal: undefined,
					error: undefined,
				},
			},
			{
				kind: "monitor_update",
				name: "ci",
				description: "CI status",
				lines: ["retrying"],
				droppedLines: undefined,
				omittedEarlierUpdates: undefined,
				exit: undefined,
			},
		]);
		// The fenced model-facing text must never surface as a user bubble.
		expect(
			entries.some(
				(entry) => "text" in entry && entry.text.includes("monitor-output"),
			),
		).toBe(false);
	});

	it("falls back to the user bubble when the metadata is malformed", () => {
		const entries = hydrateSessionMessages([
			monitorMessage({
				monitorOrigin: { kind: "monitor", updates: [{ bogus: true }] },
			}),
		]);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.kind).toBe("user_submitted");
	});
});
