import type { SessionHistoryEntry } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	agentMessagesToMessagesWithMetadata,
	messagesToAgentMessages,
} from "../../runtime/config/agent-message-codec";
import { ConversationSnapshot } from "./conversation-snapshot";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
} from "./session-compaction";

const summary = [{ role: "user" as const, content: "summary" }];
const stateFor = (history: SessionHistoryEntry[]) =>
	createSessionCompactionState({
		source: ConversationSnapshot.capture(history),
		compactedMessages: summary,
	});

describe("conversation snapshot contract", () => {
	it("projects across codec and JSON round trips with split tool results and persisted errors", () => {
		const history: SessionHistoryEntry[] = [
			{ role: "user", content: "read both files" },
			{ role: "error", content: "temporary provider failure" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "a",
						name: "read_files",
						input: { path: "a" },
					},
					{
						type: "tool_use",
						id: "b",
						name: "read_files",
						input: { path: "b" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "a",
						name: "read_files",
						content: "file a",
					},
					{
						type: "tool_result",
						tool_use_id: "b",
						name: "read_files",
						content: "file b",
					},
				],
			},
		];
		const runtime = agentMessagesToMessagesWithMetadata(
			messagesToAgentMessages(JSON.parse(JSON.stringify(history))),
		);
		expect(stateFor(history).source_prefix_hash).toBe(
			stateFor(runtime).source_prefix_hash,
		);
		expect(stateFor(history).source_message_count).toBe(4);
		for (const source of [history, runtime]) {
			for (const consumer of [history, runtime]) {
				expect(
					projectSessionCompactionState(
						stateFor(source),
						ConversationSnapshot.capture(consumer),
					),
				).toEqual({ status: "projected", messages: summary });
			}
		}
	});

	it("captures an isolated source before a compactor can mutate its input", () => {
		const history: SessionHistoryEntry[] = [
			{ role: "user", content: "original" },
		];
		const source = ConversationSnapshot.capture(history);
		history[0].content = "changed in storage";
		source.messages[0].content = "changed by compactor";
		expect(source.messages[0].content).toBe("original");
		const state = createSessionCompactionState({
			source,
			compactedMessages: summary,
		});
		expect(
			projectSessionCompactionState(
				state,
				ConversationSnapshot.capture(history),
			),
		).toEqual({ status: "invalid", reason: "source_changed" });
		expect(
			projectSessionCompactionState(state, ConversationSnapshot.capture([])),
		).toEqual({ status: "invalid", reason: "source_truncated" });
	});

	it("ignores transport, accounting and model labels but detects changed tool output", () => {
		const history: SessionHistoryEntry[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "a",
						name: "read_files",
						content: "output",
					},
				],
			},
		];
		const state = stateFor(history);
		const reloaded: SessionHistoryEntry[] = [
			{
				...history[0],
				id: "new",
				ts: 50,
				metrics: { cost: 1 },
				modelInfo: { id: "other", provider: "other" },
			},
		];
		expect(
			projectSessionCompactionState(
				state,
				ConversationSnapshot.capture(reloaded),
			).status,
		).toBe("projected");
		reloaded[0].content = [
			{
				type: "tool_result",
				tool_use_id: "a",
				name: "read_files",
				content: "changed",
			},
		];
		expect(
			projectSessionCompactionState(
				state,
				ConversationSnapshot.capture(reloaded),
			).reason,
		).toBe("source_changed");
	});
});
