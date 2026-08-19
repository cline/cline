import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	collectPersistedActiveMonitors,
	createMonitorResumeNotice,
	persistMonitorResumeNotice,
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

	it("persists the notice before a resumed session runs a turn", () => {
		let disk: MessageWithMetadata[] = [
			toolResult('Started monitor mon_1 ("ci"): Watches CI'),
		];
		const persist = (_sessionId: string, messages: MessageWithMetadata[]) => {
			disk = messages;
		};

		const firstResume = persistMonitorResumeNotice("session_1", disk, persist);
		expect(firstResume).toHaveLength(2);
		expect(disk).toEqual(firstResume);

		// Stop without an agent turn, then resume from the messages the first
		// resume already wrote. The notice must not be generated or persisted twice.
		const secondPersist = vi.fn();
		const secondResume = persistMonitorResumeNotice(
			"session_1",
			disk,
			secondPersist,
		);
		expect(secondResume).toBe(disk);
		expect(secondPersist).not.toHaveBeenCalled();
	});
});
