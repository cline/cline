import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { AgentEvent } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { forwardAgentEvent } from "./session-updates";

describe("forwardAgentEvent", () => {
	it("forwards generated images as ACP agent message chunks", () => {
		const sessionUpdate = vi.fn().mockResolvedValue(undefined);
		const connection = { sessionUpdate } as unknown as AgentSideConnection;

		forwardAgentEvent(connection, "session-1", {
			type: "content_end",
			contentType: "media",
			media: {
				id: "generated-1",
				modality: "image",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
			},
		} as AgentEvent);

		expect(sessionUpdate).toHaveBeenCalledWith({
			sessionId: "session-1",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "image",
					data: "aGVsbG8=",
					mimeType: "image/png",
				},
			},
		});
	});
});

it("separates abandoned and replacement answers in ACP's append-only output", () => {
	const sessionUpdate = vi.fn().mockResolvedValue(undefined);
	const connection = { sessionUpdate } as unknown as AgentSideConnection;
	for (const event of [
		{ type: "content_start", contentType: "text", text: "abandoned" },
		{
			type: "content_start",
			contentType: "reasoning",
			reasoning: "old thought",
		},
		{
			type: "notice",
			noticeType: "status",
			reason: "provider_error_retry",
			message: "unfinished response — retrying (attempt 1/3)",
		},
		{ type: "content_start", contentType: "text", text: "replacement" },
		{
			type: "content_start",
			contentType: "reasoning",
			reasoning: "new thought",
		},
	] satisfies AgentEvent[])
		forwardAgentEvent(connection, "session-1", event);
	expect(
		sessionUpdate.mock.calls
			.filter(([arg]) => arg.update.sessionUpdate === "agent_message_chunk")
			.map(([arg]) => arg.update.content.text)
			.join(""),
	).toBe(
		"abandoned\n\n[unfinished response — retrying (attempt 1/3)]\n\nreplacement",
	);
	expect(
		sessionUpdate.mock.calls
			.filter(([arg]) => arg.update.sessionUpdate === "agent_thought_chunk")
			.map(([arg]) => arg.update.content.text)
			.join(""),
	).toBe(
		"old thought\n\n[unfinished response — retrying (attempt 1/3)]\n\nnew thought",
	);
});
