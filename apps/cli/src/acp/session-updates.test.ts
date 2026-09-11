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
