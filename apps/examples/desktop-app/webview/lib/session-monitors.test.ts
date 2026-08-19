import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { buildActiveSessionMonitors } from "@/lib/session-monitors";

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
