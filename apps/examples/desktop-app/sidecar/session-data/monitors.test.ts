import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	collectPersistedActiveMonitors,
	createMonitorResumeNotice,
} from "./monitors";

function toolResult(text: string): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "call_1",
				name: "monitor",
				content: text,
			},
		],
	};
}

describe("monitor resume semantics", () => {
	it("finds monitors that had no terminal notification", () => {
		expect(
			collectPersistedActiveMonitors([
				toolResult('Started monitor mon_1 ("ci"): Watches CI'),
				toolResult('Started monitor mon_2 ("logs"): Watches logs'),
				{ role: "user", content: "[monitor mon_1 ended with exit code 0]" },
			]),
		).toEqual([{ id: "mon_2", name: "logs" }]);
	});

	it("creates a durable system-displayed notice for the agent and user", () => {
		const notice = createMonitorResumeNotice([{ id: "mon_2", name: "logs" }]);
		expect(notice).toMatchObject({
			role: "user",
			metadata: {
				kind: "monitor_resume_notice",
				displayRole: "system",
				reason: "session_resumed",
			},
		});
		expect(notice?.content).toContain(
			"[monitor mon_2 stopped because session resumed]",
		);
	});

	it("does not repeat the notice on a later resume", () => {
		const started = toolResult('Started monitor mon_1 ("ci"): Watches CI');
		const notice = createMonitorResumeNotice([{ id: "mon_1", name: "ci" }]);
		expect(
			collectPersistedActiveMonitors([started, notice as MessageWithMetadata]),
		).toEqual([]);
	});
});
