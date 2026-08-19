import { describe, expect, it } from "vitest";
import {
	countUserRunMessages,
	getUserRunSpan,
	isUserRunMessage,
	resolveMessageDisplayRole,
} from "./user-run-messages";

describe("user run messages", () => {
	it("counts genuine user prompts but excludes tool results and notices", () => {
		expect(getUserRunSpan({ role: "user", content: "Build it" })).toBe(1);
		expect(
			getUserRunSpan({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: "done",
					},
				],
			}),
		).toBe(0);
		expect(
			getUserRunSpan({
				role: "user",
				content: [
					{ type: "tool-result", toolUseId: "tool-2", content: "done" },
					{ type: "image", mediaType: "image/png", data: "abc" },
				],
			}),
		).toBe(0);
		expect(
			getUserRunSpan({
				role: "user",
				content: "Recovered context",
				metadata: { kind: "recovery_notice" },
			}),
		).toBe(0);
		expect(
			getUserRunSpan({
				role: "user",
				content: "Visible mid-run steering",
				metadata: { userRunSpan: 0 },
			}),
		).toBe(0);
		expect(
			getUserRunSpan({
				role: "user",
				content:
					'<user_input mode="act">[TASK RESUMPTION] Please continue where you left off.</user_input>',
			}),
		).toBe(0);
		expect(
			getUserRunSpan({
				role: "user",
				content: [
					{
						type: "text",
						text: "[TASK RESUMPTION] Please continue where you left off.",
					},
					{ type: "image", mediaType: "image/png", data: "abc" },
				],
			}),
		).toBe(1);
	});

	it("uses persisted compaction spans as absolute run contributions", () => {
		const basicCompaction = {
			role: "user",
			content: "Compacted context",
			metadata: {
				kind: "compaction",
				displayRole: "system",
				userRunSpan: 3,
			},
		};
		const agenticCompaction = {
			role: "user",
			content: "Context summary",
			metadata: {
				kind: "compaction_summary",
				displayRole: "system",
				userRunSpan: 2,
			},
		};
		const messages = [
			basicCompaction,
			agenticCompaction,
			{ role: "user", content: "Latest prompt" },
		];

		expect(getUserRunSpan(basicCompaction)).toBe(3);
		expect(getUserRunSpan(agenticCompaction)).toBe(2);
		expect(countUserRunMessages(messages)).toBe(6);
		expect(isUserRunMessage(basicCompaction)).toBe(true);
		expect(resolveMessageDisplayRole(basicCompaction)).toBe("system");
	});

	it("defaults malformed or legacy compaction spans to one run", () => {
		expect(
			getUserRunSpan({
				role: "user",
				content: "Legacy summary",
				metadata: { kind: "compaction_summary" },
			}),
		).toBe(1);
		expect(
			getUserRunSpan({
				role: "user",
				content: "Malformed span",
				metadata: { kind: "compaction", userRunSpan: -2 },
			}),
		).toBe(1);
	});
});
