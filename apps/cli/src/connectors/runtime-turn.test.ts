import { describe, expect, it, vi } from "vitest";
import type { CliLoggerAdapter } from "../logging/adapter";
import {
	createConnectorRuntimeTurnStream,
	formatConnectorToolStatus,
	summarizeConnectorToolInput,
} from "./runtime-turn";

type StreamHandlers = {
	onEvent: (event: {
		eventType: string;
		payload: Record<string, unknown>;
	}) => void;
	onError: (error: Error) => void;
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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

		expect(toolStatuses).toEqual(["Executing read_file: /tmp/demo.txt (0s)"]);
		expect(chunks.join("")).toBe("Here is the result.");
		expect(sendRuntimeSession).toHaveBeenCalledWith("session-1", request, {
			timeoutMs: null,
		});
	});

	it("streams tool progress into the status message and records completion", async () => {
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
						toolCallId: "call-1",
						toolName: "run_commands",
						input: { commands: [{ command: "npm", args: ["test"] }] },
					},
				});
				await tick();
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_update",
					payload: {
						toolCallId: "call-1",
						update: { stream: "stdout", chunk: "PASS first.test.ts\n" },
					},
				});
				await tick();
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_update",
					payload: {
						toolCallId: "call-1",
						update: { stream: "stdout", chunk: "PASS second.test.ts\n" },
					},
				});
				await tick();
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_end",
					payload: { toolCallId: "call-1", toolName: "run_commands" },
				});
				handlers?.onEvent({
					eventType: "runtime.chat.text_delta",
					payload: { text: "All tests pass." },
				});
				await tick();
				return {
					result: {
						text: "All tests pass.",
						finishReason: "stop",
						iterations: 1,
					},
				};
			},
		};

		const statuses: string[] = [];
		const chunks: string[] = [];
		for await (const chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "hi" },
			clientId: "client-1",
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "slack",
			conversationId: "thread-1",
			progressUpdateIntervalMs: 0,
			onToolStatus: async (message) => {
				statuses.push(message);
			},
		})) {
			chunks.push(chunk);
		}

		expect(statuses[0]).toBe("Executing run_commands: npm test (0s)");
		expect(statuses.some((s) => s.includes("PASS first.test.ts"))).toBe(true);
		expect(statuses.some((s) => s.includes("PASS second.test.ts"))).toBe(true);
		expect(statuses.at(-1)).toMatch(
			/^Completed run_commands: npm test in \d+s$/,
		);
		expect(chunks.join("")).toBe("All tests pass.");
	});

	it("refreshes elapsed time on a heartbeat while a tool runs silently", async () => {
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
						toolCallId: "call-1",
						toolName: "run_commands",
						input: { commands: ["sleep 30"] },
					},
				});
				await new Promise((resolve) => setTimeout(resolve, 1_150));
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_end",
					payload: { toolCallId: "call-1", toolName: "run_commands" },
				});
				await tick();
				return {
					result: { text: "", finishReason: "stop", iterations: 1 },
				};
			},
		};

		const statuses: string[] = [];
		for await (const _chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "hi" },
			clientId: "client-1",
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "slack",
			conversationId: "thread-1",
			statusHeartbeatIntervalMs: 250,
			onToolStatus: async (message) => {
				statuses.push(message);
			},
		})) {
			// consume stream
		}

		const running = statuses.filter((s) =>
			s.startsWith("Executing run_commands: sleep 30"),
		);
		expect(running.length).toBeGreaterThan(1);
		// The elapsed timer must actually advance, not just re-post the same text.
		expect(new Set(running).size).toBeGreaterThan(1);
		expect(statuses.at(-1)).toMatch(
			/^Completed run_commands: sleep 30 in \d+s$/,
		);
	});

	it("coalesces a burst of renders into the latest status message", async () => {
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
						toolCallId: "call-1",
						toolName: "run_commands",
						input: { commands: ["npm test"] },
					},
				});
				await new Promise((resolve) => setTimeout(resolve, 20));
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_update",
					payload: {
						toolCallId: "call-1",
						update: { stream: "stdout", chunk: "one\n" },
					},
				});
				await new Promise((resolve) => setTimeout(resolve, 20));
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_update",
					payload: {
						toolCallId: "call-1",
						update: { stream: "stdout", chunk: "two\n" },
					},
				});
				await new Promise((resolve) => setTimeout(resolve, 400));
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_end",
					payload: { toolCallId: "call-1", toolName: "run_commands" },
				});
				// Let the in-flight drain finish before the turn closes the stream.
				await new Promise((resolve) => setTimeout(resolve, 200));
				return {
					result: { text: "", finishReason: "stop", iterations: 1 },
				};
			},
		};

		const statuses: string[] = [];
		for await (const _chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "hi" },
			clientId: "client-1",
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "slack",
			conversationId: "thread-1",
			progressUpdateIntervalMs: 0,
			// Slow edits: everything posted while one is in flight must collapse
			// into a single follow-up edit carrying the newest render.
			onToolStatus: async (message) => {
				await new Promise((resolve) => setTimeout(resolve, 120));
				statuses.push(message);
			},
		})) {
			// consume stream
		}

		expect(statuses[0]).toBe("Executing run_commands: npm test (0s)");
		// "one" on its own was superseded before it could be sent.
		expect(statuses.some((s) => s.includes("one") && !s.includes("two"))).toBe(
			false,
		);
		const latest = statuses.find((s) => s.includes("two"));
		expect(latest).toContain("one");
		expect(statuses.at(-1)).toMatch(
			/^Completed run_commands: npm test in \d+s$/,
		);
	});

	it("reports a completion once when both projections emit tool.finished", async () => {
		let handlers: StreamHandlers | undefined;
		const client = {
			streamEvents: (_request: unknown, callbacks: StreamHandlers) => {
				handlers = callbacks;
				return () => {};
			},
			sendRuntimeSession: async () => {
				// The agent-event projection carries the toolCallId...
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_start",
					payload: {
						toolCallId: "call-1",
						toolName: "read_file",
						input: { path: "/repo/src/index.ts" },
					},
				});
				// ...and the hook projection repeats the same call by name only.
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_start",
					payload: { toolName: "read_file" },
				});
				await tick();
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_end",
					payload: { toolCallId: "call-1", toolName: "read_file" },
				});
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_end",
					payload: { toolName: "read_file" },
				});
				await tick();
				return {
					result: { text: "ok", finishReason: "stop", iterations: 1 },
				};
			},
		};

		const statuses: string[] = [];
		for await (const _chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "hi" },
			clientId: "client-1",
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "slack",
			conversationId: "thread-1",
			onToolStatus: async (message) => {
				statuses.push(message);
			},
		})) {
			// consume stream
		}

		const final = statuses.at(-1) ?? "";
		const completionLines = final
			.split("\n")
			.filter((line) => line.startsWith("Completed read_file"));
		expect(completionLines.length).toBe(1);
		// The identified event wins, so the elapsed time is preserved.
		expect(completionLines[0]).toMatch(
			/^Completed read_file: .*index\.ts in \d+s$/,
		);
	});

	it("keeps the status message inside the transport length cap", async () => {
		let handlers: StreamHandlers | undefined;
		const client = {
			streamEvents: (_request: unknown, callbacks: StreamHandlers) => {
				handlers = callbacks;
				return () => {};
			},
			sendRuntimeSession: async () => {
				// Fill the rolling history with finished tools.
				for (let i = 0; i < 12; i += 1) {
					handlers?.onEvent({
						eventType: "runtime.chat.tool_call_start",
						payload: {
							toolCallId: `done-${i}`,
							toolName: "run_commands",
							input: {
								commands: [`finished command ${i} ${"x".repeat(160)}`],
							},
						},
					});
					handlers?.onEvent({
						eventType: "runtime.chat.tool_call_end",
						payload: { toolCallId: `done-${i}`, toolName: "run_commands" },
					});
				}
				// Several concurrent tools each streaming a large output tail.
				for (let i = 0; i < 4; i += 1) {
					handlers?.onEvent({
						eventType: "runtime.chat.tool_call_start",
						payload: {
							toolCallId: `live-${i}`,
							toolName: "run_commands",
							input: { commands: [`live command ${i}`] },
						},
					});
				}
				await tick();
				for (let i = 0; i < 4; i += 1) {
					handlers?.onEvent({
						eventType: "runtime.chat.tool_call_update",
						payload: {
							toolCallId: `live-${i}`,
							update: { stream: "stdout", chunk: `${"y".repeat(900)}\n` },
						},
					});
					await tick();
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
				return {
					result: { text: "", finishReason: "stop", iterations: 1 },
				};
			},
		};

		const statuses: string[] = [];
		for await (const _chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "hi" },
			clientId: "client-1",
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "telegram",
			conversationId: "thread-1",
			progressUpdateIntervalMs: 0,
			onToolStatus: async (message) => {
				statuses.push(message);
			},
		})) {
			// consume stream
		}

		expect(statuses.length).toBeGreaterThan(0);
		// An over-long render would make the in-place edit fail on Telegram.
		expect(Math.max(...statuses.map((s) => s.length))).toBeLessThanOrEqual(
			3_500,
		);
		// The newest running tool survives the shrink.
		expect(statuses.at(-1)).toContain("live command 3");
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

describe("connector tool status formatting", () => {
	it("summarizes tool input by shape", () => {
		expect(
			summarizeConnectorToolInput({
				commands: [{ command: "npm", args: ["test"] }],
			}),
		).toBe("npm test");
		expect(summarizeConnectorToolInput({ commands: ["a", "b", "c"] })).toBe(
			"a +2 more",
		);
		expect(
			summarizeConnectorToolInput({
				files: [{ path: "/a.ts" }, { path: "/b.ts" }],
			}),
		).toBe("/a.ts +1 more");
		expect(
			summarizeConnectorToolInput({ queries: ["handleTurn", "other"] }),
		).toBe("handleTurn +1 more");
		expect(
			summarizeConnectorToolInput({ requests: [{ url: "https://x.dev" }] }),
		).toBe("https://x.dev");
		expect(summarizeConnectorToolInput({ skill: "pdf", args: "-m x" })).toBe(
			"pdf",
		);
		expect(summarizeConnectorToolInput({ mode: 3 })).toBe('{"mode":3}');
		expect(summarizeConnectorToolInput(undefined)).toBeUndefined();
	});

	it("renders start, progress, error, and complete lines", () => {
		expect(
			formatConnectorToolStatus({
				toolName: "run_commands",
				status: "start",
				toolInput: { commands: ["npm test"] },
			}),
		).toBe("Executing run_commands: npm test...");
		expect(
			formatConnectorToolStatus({
				toolName: "run_commands",
				status: "progress",
				toolInput: { commands: ["npm test"] },
				outputTail: "PASS a\n",
				elapsedMs: 12_000,
			}),
		).toBe("Executing run_commands: npm test (12s)\n```\nPASS a\n```");
		expect(
			formatConnectorToolStatus({
				toolName: "run_commands",
				status: "error",
				errorMessage: "boom",
				elapsedMs: 2_000,
			}),
		).toBe("run_commands failed after 2s: boom");
		expect(
			formatConnectorToolStatus({
				toolName: "read_files",
				status: "complete",
				toolInput: { path: "/tmp/x.ts" },
				elapsedMs: 300,
			}),
		).toBe("Completed read_files: /tmp/x.ts in 0s");
	});
});
