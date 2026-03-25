import { describe, expect, it } from "vitest";
import type { CliLoggerAdapter } from "../logging/adapter";
import { createConnectorRuntimeTurnStream } from "./runtime-turn";

type StreamHandlers = {
	onEvent: (event: {
		eventType: string;
		payload: Record<string, unknown>;
	}) => void;
	onError: (error: Error) => void;
};

describe("createConnectorRuntimeTurnStream", () => {
	it("delivers tool status via callbacks instead of appending it to streamed text", async () => {
		let handlers: StreamHandlers | undefined;

		const client = {
			streamEvents: (_request: unknown, callbacks: StreamHandlers) => {
				handlers = callbacks;
				return () => {};
			},
			sendRuntimeSession: async () => {
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_start",
					payload: {
						toolName: "read_file",
						input: { path: "/tmp/demo.txt" },
					},
				});
				handlers?.onEvent({
					eventType: "runtime.chat.text_delta",
					payload: { text: "Here is the result." },
				});
				return {
					result: {
						text: "Here is the result.",
						finishReason: "stop",
						iterations: 1,
					},
				};
			},
		};

		const chunks: string[] = [];
		const toolStatuses: string[] = [];
		for await (const chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "hi" },
			clientId: "client-1",
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "telegram",
			conversationId: "thread-1",
			onToolStatus: async (message) => {
				toolStatuses.push(message);
			},
		})) {
			chunks.push(chunk);
		}

		expect(toolStatuses).toEqual(["Executing read_file..."]);
		expect(chunks.join("")).toBe("Here is the result.");
	});
});
