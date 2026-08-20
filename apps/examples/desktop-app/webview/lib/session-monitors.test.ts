import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	buildActiveSessionMonitors,
	monitorSuppressionKey,
	pruneMonitorSuppressions,
} from "@/lib/session-monitors";

let messageCounter = 0;

function message(
	role: ChatMessage["role"],
	content: string,
	toolName?: string,
): ChatMessage {
	messageCounter += 1;
	return {
		id: `message_${messageCounter}`,
		sessionId: "session_1",
		role,
		content,
		createdAt: messageCounter,
		meta: toolName ? { toolName } : undefined,
	};
}

function monitorResult(result: string): ChatMessage {
	return message(
		"tool",
		JSON.stringify({ toolName: "monitor", result, isError: false }),
		"monitor",
	);
}

describe("buildActiveSessionMonitors", () => {
	it("tracks successful monitor starts", () => {
		expect(
			buildActiveSessionMonitors([
				monitorResult(
					'Started monitor mon_1 ("ci"): Watches CI\nCommand: gh pr checks',
				),
			]),
		).toEqual([{ id: "mon_1", name: "ci" }]);
	});

	it("removes explicitly stopped monitors", () => {
		expect(
			buildActiveSessionMonitors([
				monitorResult('Started monitor mon_1 ("ci"): Watches CI'),
				monitorResult('Stopped monitor mon_1 ("ci").'),
			]),
		).toEqual([]);
	});

	it("removes monitors named by a system resume notice", () => {
		expect(
			buildActiveSessionMonitors([
				monitorResult('Started monitor mon_1 ("ci"): Watches CI'),
				message(
					"system",
					"<system-reminder>\nResuming this session rebuilt its runtime and stopped an active monitor: ci (mon_1).\n[monitor mon_1 stopped because session resumed]\n</system-reminder>",
				),
			]),
		).toEqual([]);
	});

	it("removes monitors after a natural exit notification", () => {
		expect(
			buildActiveSessionMonitors([
				monitorResult('Started monitor mon_1 ("server"): Watches server'),
				message(
					"user",
					"Background output\n[monitor mon_1 ended with exit code 0]",
				),
			]),
		).toEqual([]);
	});

	it("uses list results to refine monitor status", () => {
		expect(
			buildActiveSessionMonitors([
				monitorResult('Started monitor mon_1 ("old"): Old watch'),
				monitorResult(
					'mon_1 [exited] "old": Old watch\nmon_2 [running] "logs": Tail logs',
				),
			]),
		).toEqual([{ id: "mon_2", name: "logs" }]);
	});

	it("ignores unrelated and failed tool results", () => {
		expect(
			buildActiveSessionMonitors([
				message(
					"tool",
					JSON.stringify({
						toolName: "monitor",
						result: 'Started monitor mon_1 ("ci"): Watches CI',
						isError: true,
					}),
					"monitor",
				),
				message("tool", "not json", "read_files"),
			]),
		).toEqual([]);
	});
});

describe("pruneMonitorSuppressions", () => {
	it("keeps a suppression while the stopped monitor still parses as active", () => {
		const suppressed = new Set([monitorSuppressionKey("session_1", "mon_1")]);
		expect(
			pruneMonitorSuppressions(
				suppressed,
				[{ id: "mon_1", name: "ci" }],
				"session_1",
			),
		).toBe(suppressed);
	});

	it("drops a suppression once its terminal marker lands", () => {
		expect(
			pruneMonitorSuppressions(
				new Set([monitorSuppressionKey("session_1", "mon_1")]),
				[],
				"session_1",
			),
		).toEqual(new Set());
	});

	it("does not let a stale suppression hide a reused monitor id", () => {
		// User stops mon_1, the marker lands, and a rebuilt runtime later hands
		// out mon_1 again to a different monitor: the new monitor must show.
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
