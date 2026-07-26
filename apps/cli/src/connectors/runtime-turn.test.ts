import { describe, expect, it, vi } from "vitest";
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

		const sendRuntimeSession = vi.fn(async () => {
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
		});
		const client = {
			streamEvents: (_request: unknown, callbacks: StreamHandlers) => {
				handlers = callbacks;
				return () => {};
			},
			sendRuntimeSession,
		};
		const request = { config: {} as never, prompt: "hi" };

		const chunks: string[] = [];
		const toolStatuses: string[] = [];
		for await (const chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request,
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
		expect(sendRuntimeSession).toHaveBeenCalledWith("session-1", request, {
			timeoutMs: null,
		});
	});

	it("keeps streaming when tool status delivery fails", async () => {
		let handlers: StreamHandlers | undefined;
		const log = vi.fn();
		const statusError = new Error("message_not_found");
		const client = {
			streamEvents: (_request: unknown, callbacks: StreamHandlers) => {
				handlers = callbacks;
				return () => {};
			},
			sendRuntimeSession: async () => {
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_start",
					payload: { toolName: "run_commands" },
				});
				await new Promise((resolve) => setTimeout(resolve, 0));
				handlers?.onEvent({
					eventType: "runtime.chat.text_delta",
					payload: { text: "Final response" },
				});
				return {
					result: {
						text: "Final response",
						finishReason: "stop",
						iterations: 1,
					},
				};
			},
		};

		const chunks: string[] = [];
		for await (const chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "hi" },
			clientId: "client-1",
			logger: { core: { log } } as unknown as CliLoggerAdapter,
			transport: "slack",
			conversationId: "thread-1",
			onToolStatus: async () => {
				throw statusError;
			},
		})) {
			chunks.push(chunk);
		}

		expect(chunks.join("")).toBe("Final response");
		expect(log).toHaveBeenCalledWith(
			"Connector tool status delivery failed",
			expect.objectContaining({
				severity: "warn",
				transport: "slack",
				error: statusError,
			}),
		);
	});

	it("treats queued runtime turns as non-error completion", async () => {
		const log = vi.fn();
		const client = {
			streamEvents: (_request: unknown, _callbacks: StreamHandlers) => {
				return () => {};
			},
			sendRuntimeSession: vi.fn(async () => ({})),
		};

		const chunks: string[] = [];
		for await (const chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "hi" },
			clientId: "client-1",
			logger: { core: { log } } as unknown as CliLoggerAdapter,
			transport: "discord",
			conversationId: "thread-1",
		})) {
			chunks.push(chunk);
		}

		expect(chunks).toEqual([]);
		expect(log).toHaveBeenCalledWith(
			"Connector runtime turn queued",
			expect.objectContaining({
				transport: "discord",
				sessionId: "session-1",
			}),
		);
	});

	it("surfaces normalized runtime failed errors", async () => {
		let handlers: StreamHandlers | undefined;

		const client = {
			streamEvents: (_request: unknown, callbacks: StreamHandlers) => {
				handlers = callbacks;
				return () => {};
			},
			sendRuntimeSession: async () => {
				handlers?.onEvent({
					eventType: "runtime.chat.failed",
					payload: {
						reason: "error",
						error: "Invalid API key",
					},
				});
				return {
					result: {
						text: "Invalid API key",
						finishReason: "error",
						iterations: 1,
					},
				};
			},
		};

		const failures: string[] = [];
		await expect(async () => {
			for await (const _chunk of createConnectorRuntimeTurnStream({
				client: client as never,
				sessionId: "session-1",
				request: { config: {} as never, prompt: "hi" },
				clientId: "client-1",
				logger: { core: {} } as unknown as CliLoggerAdapter,
				transport: "telegram",
				conversationId: "thread-1",
				onFailed: async (error) => {
					failures.push(error.message);
				},
			})) {
				// consume stream
			}
		}).rejects.toThrow("Invalid API key");

		expect(failures).toEqual(["Invalid API key"]);
	});

	it("surfaces normalized runtime failed errors", async () => {
		let handlers: StreamHandlers | undefined;

		const client = {
			streamEvents: (_request: unknown, callbacks: StreamHandlers) => {
				handlers = callbacks;
				return () => {};
			},
			sendRuntimeSession: async () => {
				handlers?.onEvent({
					eventType: "runtime.chat.failed",
					payload: {
						reason: "error",
						error: "Invalid API key",
					},
				});
				return {
					result: {
						text: "Invalid API key",
						finishReason: "error",
						iterations: 1,
					},
				};
			},
		};

		const failures: string[] = [];
		await expect(async () => {
			for await (const _chunk of createConnectorRuntimeTurnStream({
				client: client as never,
				sessionId: "session-1",
				request: { config: {} as never, prompt: "hi" },
				clientId: "client-1",
				logger: { core: {} } as unknown as CliLoggerAdapter,
				transport: "telegram",
				conversationId: "thread-1",
				onFailed: async (error) => {
					failures.push(error.message);
				},
			})) {
				// consume stream
			}
		}).rejects.toThrow("Invalid API key");

		expect(failures).toEqual(["Invalid API key"]);
	});
});
