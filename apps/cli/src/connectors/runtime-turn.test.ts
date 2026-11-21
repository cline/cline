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
	it("forwards generated media without adding binary data to the text stream", async () => {
		let handlers: StreamHandlers | undefined;
		const media = {
			id: "generated-1",
			modality: "image" as const,
			mediaType: "image/png",
			source: { type: "base64" as const, data: "aGVsbG8=" },
		};
		const client = {
			streamEvents: (_request: unknown, callbacks: StreamHandlers) => {
				handlers = callbacks;
				return () => {};
			},
			sendRuntimeSession: async () => {
				handlers?.onEvent({
					eventType: "runtime.chat.media",
					payload: { media },
				});
				return { result: { text: "", finishReason: "stop", iterations: 1 } };
			},
		};
		const receivedMedia: unknown[] = [];
		const chunks: string[] = [];

		for await (const chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "make an image" },
			clientId: "client-1",
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "slack",
			conversationId: "thread-1",
			onMedia: (item) => {
				receivedMedia.push(item);
			},
		})) {
			chunks.push(chunk);
		}

		expect(chunks).toEqual([]);
		expect(receivedMedia).toEqual([media]);
	});

	it("streams only the successful submit_and_exit summary", async () => {
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
			handlers?.onEvent({
				eventType: "runtime.chat.tool_call_start",
				payload: {
					toolName: "submit_and_exit",
					input: {
						summary: "The result is ready and verified.",
						verified: true,
					},
				},
			});
			handlers?.onEvent({
				eventType: "runtime.chat.tool_call_end",
				payload: { toolName: "submit_and_exit" },
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
		for await (const chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request,
			clientId: "client-1",
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "telegram",
			conversationId: "thread-1",
		})) {
			chunks.push(chunk);
		}

		expect(chunks.join("")).toBe("The result is ready and verified.");
		expect(sendRuntimeSession).toHaveBeenCalledWith("session-1", request, {
			timeoutMs: null,
		});
	});

	it("hides narration and tool activity when no completion tool is called", async () => {
		let handlers: StreamHandlers | undefined;
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
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "slack",
			conversationId: "thread-1",
		})) {
			chunks.push(chunk);
		}

		expect(chunks.join("")).toBe("");
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
