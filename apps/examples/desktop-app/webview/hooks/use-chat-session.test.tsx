// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./use-chat-session";

const { invokeMock, subscribeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	subscribeMock: vi.fn(
		(_eventName: string, _handler: (payload: unknown) => void) => () =>
			undefined,
	),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		getTransportError: vi.fn(() => null),
		getTransportState: vi.fn(() => "connected"),
		invoke: invokeMock,
		subscribe: subscribeMock,
		subscribeTransportState: vi.fn(() => () => undefined),
	},
}));

type ChatSessionHook = ReturnType<typeof useChatSession>;

let container: HTMLDivElement;
let root: Root;
let current: ChatSessionHook;

function HookHarness() {
	current = useChatSession();
	return null;
}

beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.localStorage.clear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	invokeMock.mockReset();
	subscribeMock.mockClear();
	invokeMock.mockImplementation(async (command: string) => {
		if (command === "get_process_context") {
			return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
		}
		return [];
	});
	await act(async () => root.render(<HookHarness />));
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("useChatSession", () => {
	it("starts without a selected workspace and adopts the SDK temporary path", async () => {
		let startedSessionId = "";
		await act(async () => {
			current.setWorkspacePath("");
		});
		invokeMock.mockClear();
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command !== "chat_session_command") return [];
				const request = args?.request as
					| { action?: string; config?: Record<string, unknown> }
					| undefined;
				if (request?.action === "start") {
					const sessionId = String(
						request.config?.sessionId ?? "session-pathless",
					);
					startedSessionId = sessionId;
					const workspacePath = "/home/host/.cline/data/workspaces/chat";
					return {
						sessionId,
						cwd: workspacePath,
						workspaceRoot: workspacePath,
					};
				}
				if (request?.action === "send") {
					return {
						ok: true,
						result: { text: "done", finishReason: "completed" },
					};
				}
				return [];
			},
		);

		await act(async () => current.sendPrompt("Start the task"));

		expect(current.error).toBeNull();
		expect(startedSessionId).toMatch(/^session_/);
		const expectedWorkspacePath = "/home/host/.cline/data/workspaces/chat";
		expect(current.config).toMatchObject({
			cwd: expectedWorkspacePath,
			workspaceRoot: expectedWorkspacePath,
		});
		expect(invokeMock).toHaveBeenCalledWith("chat_session_command", {
			request: expect.objectContaining({
				action: "start",
				config: expect.objectContaining({ cwd: "", workspaceRoot: "" }),
			}),
		});
		expect(invokeMock).toHaveBeenCalledWith(
			"chat_session_command",
			{
				request: expect.objectContaining({
					action: "send",
					prompt: "Start the task",
				}),
			},
			{ timeoutMs: null },
		);
	});

	it("preserves server validation errors", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
			}
			if (command === "chat_session_command") {
				throw new Error(
					'[{"origin":"string","code":"too_small","path":["workspaces","/","hint"],"message":"Too small: expected string to have >=1 characters"}]',
				);
			}
			return [];
		});

		await act(async () => current.start(current.config));

		const expected =
			'[{"origin":"string","code":"too_small","path":["workspaces","/","hint"],"message":"Too small: expected string to have >=1 characters"}]';
		expect(current.error).toBe(expected);
		expect(current.messages.at(-1)?.content).toBe(expected);
	});

	it.each([
		{
			finishReason: "completed",
			expected:
				'[{"code":"too_small","path":["workspaces","/","hint"],"message":"expected string to have >=1 characters"}]',
		},
		{
			finishReason: "error",
			expected:
				'[{"code":"too_small","path":["workspaces","/","hint"],"message":"expected string to have >=1 characters"}]',
		},
	])("handles schema-like assistant text for $finishReason responses", async ({
		finishReason,
		expected,
	}) => {
		const schemaLikeText =
			'[{"code":"too_small","path":["workspaces","/","hint"],"message":"expected string to have >=1 characters"}]';
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return {
						cwd: "/workspace/cline",
						workspaceRoot: "/workspace/cline",
					};
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return {
							sessionId: request.config?.sessionId ?? "session-test",
							cwd: "/workspace/cline",
							workspaceRoot: "/workspace/cline",
						};
					}
					if (request?.action === "send") {
						return {
							ok: true,
							result: { text: schemaLikeText, finishReason },
						};
					}
				}
				return [];
			},
		);

		await act(async () => current.sendPrompt("Explain this validation error"));

		expect(
			current.messages.findLast((message) => message.role === "assistant")
				?.content,
		).toBe(expected);
	});

	it("publishes the first user message before cold session startup resolves", async () => {
		let resolveStart: ((value: { sessionId: string }) => void) | undefined;
		const startResponse = new Promise<{ sessionId: string }>((resolve) => {
			resolveStart = resolve;
		});
		let plannedSessionId = "";
		let startConfig:
			| { thinking?: boolean; reasoningEffort?: string; sessionId?: string }
			| undefined;
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| {
								action?: string;
								config?: {
									sessionId?: string;
									thinking?: boolean;
									reasoningEffort?: string;
								};
						  }
						| undefined;
					if (request?.action === "start") {
						plannedSessionId = request.config?.sessionId ?? "";
						startConfig = request.config;
						return await startResponse;
					}
					if (request?.action === "send") {
						return {
							ok: true,
							result: { text: "Ready", finishReason: "completed" },
						};
					}
					return { promptsInQueue: [] };
				}
				return [];
			},
		);

		await act(async () => {
			current.setConfig((previous) => ({
				...previous,
				thinking: true,
				reasoningEffort: "high",
			}));
		});
		let sendPromise: Promise<void> | undefined;
		await act(async () => {
			sendPromise = current.sendPrompt("Start the task");
			await Promise.resolve();
		});

		expect(current.status).toBe("starting");
		expect(current.messages).toHaveLength(1);
		expect(current.messages[0]).toMatchObject({
			role: "user",
			content: "Start the task",
		});
		expect(current.messages[0]?.sessionId).toMatch(/^session_/);
		expect(plannedSessionId).toBe(current.messages[0]?.sessionId);
		expect(startConfig).toMatchObject({
			thinking: true,
			reasoningEffort: "high",
			sessionId: plannedSessionId,
		});

		await act(async () => {
			resolveStart?.({ sessionId: plannedSessionId });
			await sendPromise;
		});
		expect(
			current.messages.some((message) => message.content === "Ready"),
		).toBe(true);
	});

	it("overlaps attachment serialization with cold session startup", async () => {
		let resolveStart: ((value: { sessionId: string }) => void) | undefined;
		let resolveFile: ((value: string) => void) | undefined;
		const startResponse = new Promise<{ sessionId: string }>((resolve) => {
			resolveStart = resolve;
		});
		const fileContent = new Promise<string>((resolve) => {
			resolveFile = resolve;
		});
		const text = vi.fn(async () => await fileContent);
		const attachment = {
			name: "notes.txt",
			type: "text/plain",
			size: 5,
			lastModified: 1,
			text,
		} as unknown as File;
		let plannedSessionId = "";
		let sentAttachments: unknown;
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| {
								action?: string;
								config?: { sessionId?: string };
								attachments?: unknown;
						  }
						| undefined;
					if (request?.action === "start") {
						plannedSessionId = request.config?.sessionId ?? "";
						return await startResponse;
					}
					if (request?.action === "send") {
						sentAttachments = request.attachments;
						return {
							ok: true,
							result: { text: "Done", finishReason: "completed" },
						};
					}
					return { promptsInQueue: [] };
				}
				return [];
			},
		);

		let sendPromise: Promise<void> | undefined;
		await act(async () => {
			sendPromise = current.sendPrompt("Read this", [attachment]);
			await Promise.resolve();
		});

		expect(text).toHaveBeenCalledTimes(1);
		expect(plannedSessionId).toMatch(/^session_/);

		await act(async () => {
			resolveStart?.({ sessionId: plannedSessionId });
			await Promise.resolve();
		});
		expect(sentAttachments).toBeUndefined();

		await act(async () => {
			resolveFile?.("hello");
			await sendPromise;
		});
		expect(sentAttachments).toEqual({
			userImages: [],
			userFiles: [{ name: "notes.txt", content: "hello" }],
		});
	});

	it("adds an attached image to the optimistic user message", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return {
							ok: true,
							result: { text: "Done", finishReason: "completed" },
						};
					}
				}
				return [];
			},
		);
		const attachment = new File([new Uint8Array([1, 2, 3])], "shot.png", {
			type: "image/png",
		});

		await act(async () => {
			await current.sendPrompt("Describe this", [attachment]);
		});

		expect(current.messages.find((message) => message.role === "user")).toEqual(
			expect.objectContaining({
				content: "Describe this",
				images: [
					expect.objectContaining({
						mediaType: "image/png",
						data: "AQID",
					}),
				],
			}),
		);
	});

	it("keeps distinct image previews for queued prompts with identical text", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return {
							ok: true,
							result: { text: "Done", finishReason: "completed" },
						};
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("First prompt");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(chatEventHandler).toBeDefined();

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-prompt-1",
					prompt: "Describe this",
					attachmentCount: 1,
					userImages: ["data:image/png;base64,AQID"],
				}),
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-prompt-2",
					prompt: "Describe this",
					attachmentCount: 1,
					userImages: ["data:image/png;base64,BAUG"],
				}),
				ts: Date.now(),
				index: 2,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-prompt-2",
					prompt: "Describe this",
					attachmentCount: 1,
					userImages: ["data:image/png;base64,BAUG"],
				}),
				ts: Date.now(),
				index: 3,
			});
		});

		const queuedMessages = current.messages.filter(
			(message) =>
				message.id === "queued_user_queued-prompt-1" ||
				message.id === "queued_user_queued-prompt-2",
		);
		expect(queuedMessages).toHaveLength(2);
		expect(queuedMessages.map((message) => message.content)).toEqual([
			"Describe this",
			"Describe this",
		]);
		expect(queuedMessages.map((message) => message.images?.[0]?.data)).toEqual([
			"AQID",
			"BAUG",
		]);
	});

	it("re-keys the optimistic bubble when the runtime queues the same prompt", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						// A prompt the runtime consumed from its queue resolves
						// without a turn result; chat_done ends the turn instead.
						return { ok: true, result: {} };
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("hi there");
		});
		expect(
			current.messages.filter((message) => message.content === "hi there"),
		).toHaveLength(1);

		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(chatEventHandler).toBeDefined();

		// The runtime queued the prompt during session startup, so the drain
		// announces it as a queued prompt start for the same content.
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-prompt-1",
					prompt: "hi there",
					attachmentCount: 0,
				}),
				ts: Date.now(),
				index: 1,
			});
		});

		const userMessages = current.messages.filter(
			(message) => message.role === "user" && message.content === "hi there",
		);
		expect(userMessages).toHaveLength(1);
		expect(userMessages[0]?.id).toBe("queued_user_queued-prompt-1");
	});

	it("keeps a stale same-content bubble distinct from a new queued prompt", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return { ok: true, result: {} };
					}
				}
				return [];
			},
		);

		// A prompt whose turn ended without assistant output (e.g. cancelled)
		// leaves its optimistic bubble at the transcript tail.
		await act(async () => {
			await current.sendPrompt("something");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(chatEventHandler).toBeDefined();
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "aborted" }),
				ts: Date.now(),
				index: 1,
			});
		});

		// A later submission of the same text, queued while the agent was
		// busy, has no optimistic bubble: its queued-start event must append
		// a new message, not swallow the stale one.
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-prompt-2",
					prompt: "something",
					attachmentCount: 0,
				}),
				ts: Date.now(),
				index: 2,
			});
		});

		const userMessages = current.messages.filter(
			(message) => message.role === "user" && message.content === "something",
		);
		expect(userMessages).toHaveLength(2);
		expect(userMessages[1]?.id).toBe("queued_user_queued-prompt-2");
	});

	it("keeps live stream timestamps in milliseconds", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return { ok: true };
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("Think about this");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const userMessage = current.messages.find(
			(message) => message.role === "user",
		);
		expect(chatEventHandler).toBeDefined();
		expect(userMessage).toBeDefined();
		const thinkingTimestamp = (userMessage?.createdAt ?? Date.now()) + 5_000;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_reasoning",
				chunk: JSON.stringify({ text: "Considering the request." }),
				ts: thinkingTimestamp,
				index: 42,
			});
		});

		expect(
			current.messages.find((message) => message.role === "assistant")
				?.createdAt,
		).toBe(thinkingTimestamp);
	});

	it("updates current token usage from live usage events", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return { ok: true };
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("Track this turn");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_usage",
				chunk: JSON.stringify({
					inputTokens: 12_000,
					outputTokens: 500,
					cost: 0.01,
				}),
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_usage",
				chunk: JSON.stringify({
					inputTokens: 13_000,
					outputTokens: 700,
					cacheReadTokens: 4_000,
					cost: 0.02,
				}),
				ts: Date.now(),
				index: 2,
			});
		});

		expect(current.summary).toMatchObject({
			tokensIn: 13_000,
			tokensOut: 700,
			cacheReadTokens: 4_000,
		});
		expect(current.summary.totalCostUsd).toBeCloseTo(0.03);
	});

	it("preserves consecutive queued costs while the preceding turn is persisted", async () => {
		type SendResponse = {
			ok: true;
			result: {
				text: string;
				finishReason: "completed";
				usage: {
					inputTokens: number;
					outputTokens: number;
					totalCost: number;
				};
			};
		};
		let resolveSend: ((response: SendResponse) => void) | undefined;
		const sendResponse = new Promise<SendResponse>((resolve) => {
			resolveSend = resolve;
		});
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return await sendResponse;
					}
				}
				return [];
			},
		);

		let sendTask: Promise<void> | undefined;
		await act(async () => {
			sendTask = current.sendPrompt("Track this completed turn");
			await Promise.resolve();
			await Promise.resolve();
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_usage",
				chunk: JSON.stringify({
					inputTokens: 12_000,
					outputTokens: 500,
					cost: 0.01,
				}),
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_usage",
				chunk: JSON.stringify({
					inputTokens: 13_000,
					outputTokens: 700,
					cost: 0.02,
				}),
				ts: Date.now(),
				index: 2,
			});
		});
		expect(current.summary.totalCostUsd).toBeCloseTo(0.03);

		// The runtime may begin draining the next queued prompt before the prior
		// send response reaches the webview. Its deltas must not affect the prior
		// turn's completion reconciliation.
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-next",
					prompt: "Next turn",
				}),
				ts: Date.now(),
				index: 3,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_usage",
				chunk: JSON.stringify({ cost: 0.01 }),
				ts: Date.now(),
				index: 4,
			});
		});
		expect(current.summary.totalCostUsd).toBeCloseTo(0.04);

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "completed" }),
				ts: Date.now(),
				index: 5,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-after-next",
					prompt: "Turn after next",
				}),
				ts: Date.now(),
				index: 6,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_usage",
				chunk: JSON.stringify({ cost: 0.02 }),
				ts: Date.now(),
				index: 7,
			});
		});
		expect(current.summary.totalCostUsd).toBeCloseTo(0.06);

		await act(async () => {
			resolveSend?.({
				ok: true,
				result: {
					text: "Completed turn",
					finishReason: "completed",
					usage: {
						inputTokens: 13_000,
						outputTokens: 700,
						totalCost: 0.03,
					},
				},
			});
			await sendTask;
		});

		expect(current.summary).toMatchObject({
			tokensIn: 13_000,
			tokensOut: 700,
		});
		expect(current.summary.totalCostUsd).toBeCloseTo(0.06);
	});

	it("hydrates current token usage and cumulative cost from messages", async () => {
		const hydratedSessionId = "session-with-usage";
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return [
						{
							id: "assistant-1",
							sessionId: hydratedSessionId,
							role: "assistant",
							content: "First response",
							createdAt: 1,
							meta: {
								inputTokens: 10_000,
								outputTokens: 500,
								totalCost: 0.01,
							},
						},
						{
							id: "assistant-2",
							sessionId: hydratedSessionId,
							role: "assistant",
							content: "Latest response",
							createdAt: 2,
							meta: {
								inputTokens: 24_000,
								outputTokens: 1_000,
								cacheReadTokens: 8_000,
								totalCost: 0.02,
							},
						},
					];
				}
				if (command === "read_session_hooks") return [];
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "attach") {
						return {
							sessionId: hydratedSessionId,
							status: "completed",
							provider: "cline",
							model: "test-model",
							cwd: "/workspace/cline",
							workspaceRoot: "/workspace/cline",
						};
					}
					return { promptsInQueue: [] };
				}
				return [];
			},
		);

		await act(async () => {
			await current.hydrateSession({
				sessionId: hydratedSessionId,
				status: "completed",
				provider: "cline",
				model: "test-model",
				cwd: "/workspace/cline",
				workspaceRoot: "/workspace/cline",
				startedAt: "2026-07-31T00:00:00.000Z",
			});
		});

		expect(current.summary).toMatchObject({
			tokensIn: 24_000,
			tokensOut: 1_000,
			cacheReadTokens: 8_000,
		});
		expect(current.summary.totalCostUsd).toBeCloseTo(0.03);
	});

	it("returns to a completed status when a queued turn finishes via chat_done", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						// The runtime queued the prompt (e.g. the interactive loop was
						// still starting), so the RPC resolves without a turn result.
						return { ok: true };
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("First prompt");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(chatEventHandler).toBeDefined();

		// Runtime consumes the queued prompt: the UI flips to running.
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-prompt-1",
					prompt: "First prompt",
				}),
				ts: Date.now(),
				index: 1,
			});
		});
		expect(current.status).toBe("running");

		// The turn ends: chat_done is the only completion signal for queued
		// turns, so it must clear the busy status.
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "completed", text: "pong" }),
				ts: Date.now(),
				index: 2,
			});
		});
		expect(current.status).toBe("completed");
	});

	it("stays running on chat_done while more prompts wait in the queue", async () => {
		// Server-side queue truth: chat_done double-checks pending prompts
		// against the server, so the mock must answer consistently with the
		// snapshots the test pushes below.
		let serverQueue: Array<{ id: string; prompt: string; steer: boolean }> = [];
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return { ok: true };
					}
					if (request?.action === "pending_prompts") {
						return { ok: true, promptsInQueue: serverQueue };
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("First prompt");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const queueStateHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "prompts_in_queue_state",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(chatEventHandler).toBeDefined();
		expect(queueStateHandler).toBeDefined();

		// A second prompt is waiting in the queue when the first turn ends.
		serverQueue = [{ id: "queued-2", prompt: "Second prompt", steer: false }];
		await act(async () => {
			queueStateHandler?.({
				sessionId: current.sessionId,
				items: [{ id: "queued-2", prompt: "Second prompt", steer: false }],
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-1",
					prompt: "First prompt",
				}),
				ts: Date.now(),
				index: 1,
			});
		});
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "completed" }),
				ts: Date.now(),
				index: 2,
			});
		});
		expect(current.status).toBe("running");

		// Once the queue drains, the next chat_done releases the composer.
		serverQueue = [];
		await act(async () => {
			queueStateHandler?.({
				sessionId: current.sessionId,
				items: [],
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-2",
					prompt: "Second prompt",
				}),
				ts: Date.now(),
				index: 3,
			});
		});
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "completed" }),
				ts: Date.now(),
				index: 4,
			});
		});
		expect(current.status).toBe("completed");
	});

	it("marks a queued turn as failed when chat_done reports an error", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return { ok: true };
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("First prompt");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "queued-prompt-1",
					prompt: "First prompt",
				}),
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "error" }),
				ts: Date.now(),
				index: 2,
			});
		});
		expect(current.status).toBe("failed");
		// The failure must be visible in the transcript — queued turns never
		// resolve through the send RPC, so chat_done is the only error signal.
		const errorMessages = current.messages.filter(
			(message) => message.role === "error",
		);
		expect(errorMessages).toHaveLength(1);
		expect(errorMessages[0]?.content).toContain("The run failed");
		// The optimistic user message and the queued materialization of the
		// same prompt must not duplicate each other.
		const userMessages = current.messages.filter(
			(message) => message.role === "user",
		);
		expect(userMessages).toHaveLength(1);
		expect(userMessages[0]?.content).toBe("First prompt");
	});

	it("explains a failed turn with the latest core error log", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return { ok: true };
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("First prompt");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_core_log",
				chunk: JSON.stringify({
					level: "error",
					message: "Unauthorized: invalid API key",
				}),
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "error" }),
				ts: Date.now(),
				index: 2,
			});
		});
		expect(current.status).toBe("failed");
		const errorMessage = current.messages.find(
			(message) => message.role === "error",
		);
		expect(errorMessage?.content).toContain("Unauthorized: invalid API key");
		expect(errorMessage?.content).toContain("Settings");
	});

	it("never attributes an earlier turn's core error to a later detail-less failure", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return { ok: true };
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("First prompt");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;

		// Turn A logs an error-level entry but ultimately completes (e.g. an
		// internal retry succeeded). Its remembered error must die with it.
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_core_log",
				chunk: JSON.stringify({
					level: "error",
					message: "Unauthorized: invalid API key",
				}),
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "completed" }),
				ts: Date.now(),
				index: 2,
			});
		});

		// Turn B's start and log events were lost across a transport
		// interruption (websocket events are not replayed); only its
		// detail-less failure arrives. It must not resurrect turn A's error.
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "error" }),
				ts: Date.now(),
				index: 3,
			});
		});
		expect(current.status).toBe("failed");
		const errorMessage = current.messages.find(
			(message) => message.role === "error",
		);
		expect(errorMessage?.content).toContain(
			"The run failed before a response was produced.",
		);
		expect(errorMessage?.content).not.toContain("Unauthorized");
	});

	it("keeps the failure message when post-send hydration replaces the transcript", async () => {
		// Real race: the runtime queues the first prompt of a fresh session, the
		// turn fails fast (chat_done error appends the failure bubble), and only
		// then the send RPC resolves — whose canonical-history hydration used to
		// replace the transcript wholesale, wiping the UI-only error bubble.
		let resolveSend: ((value: unknown) => void) | undefined;
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return [
						{
							id: "hist_user_1",
							sessionId: args?.sessionId,
							role: "user",
							content: "First prompt",
							createdAt: Date.now(),
						},
					];
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return await new Promise((resolve) => {
							resolveSend = resolve;
						});
					}
				}
				return [];
			},
		);

		let sendPromise: Promise<void> | undefined;
		await act(async () => {
			sendPromise = current.sendPrompt("First prompt");
		});
		for (let i = 0; i < 10 && !resolveSend; i++) {
			await act(async () => {
				await Promise.resolve();
			});
		}
		expect(resolveSend).toBeDefined();

		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "error" }),
				ts: Date.now(),
				index: 1,
			});
		});
		expect(
			current.messages.some((message) => message.role === "error"),
		).toBe(true);

		await act(async () => {
			resolveSend?.({ ok: true });
			await sendPromise;
		});

		// Canonical hydration replaced the transcript with persisted messages,
		// which never contain UI-only error bubbles — the failure explanation
		// must survive.
		const userMessages = current.messages.filter(
			(message) => message.role === "user",
		);
		expect(userMessages).toHaveLength(1);
		const errorMessages = current.messages.filter(
			(message) => message.role === "error",
		);
		expect(errorMessages).toHaveLength(1);
		expect(errorMessages[0]?.content).toContain("The run failed");
	});

	it("does not give credential guidance for non-credential failures", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return { ok: true };
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.sendPrompt("First prompt");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_core_log",
				chunk: JSON.stringify({
					level: "error",
					message: "Request exceeded the maximum context tokens for this model",
				}),
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "error" }),
				ts: Date.now(),
				index: 2,
			});
		});
		expect(current.status).toBe("failed");
		const errorMessage = current.messages.find(
			(message) => message.role === "error",
		);
		// "tokens" here is a context-window problem, not a credential problem;
		// pointing users at Settings → Models would be misleading.
		expect(errorMessage?.content).toContain("maximum context tokens");
		expect(errorMessage?.content).not.toContain("Check your model connection");
	});

	it("drops stale failure bubbles from earlier turns on later hydration", async () => {
		const history: Array<Record<string, unknown>> = [];
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return history.map((message) => ({
						...message,
						sessionId: args?.sessionId,
					}));
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return { ok: true };
					}
				}
				return [];
			},
		);

		history.push({
			id: "hist_user_1",
			role: "user",
			content: "First prompt",
			createdAt: Date.now(),
		});
		await act(async () => {
			await current.sendPrompt("First prompt");
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "error" }),
				ts: Date.now(),
				index: 1,
			});
		});
		expect(
			current.messages.some((message) => message.role === "error"),
		).toBe(true);

		// A later turn appends new messages after the failure bubble; its
		// hydration must not re-pin the stale error to the bottom of the
		// transcript out of chronological order.
		history.push({
			id: "hist_user_2",
			role: "user",
			content: "Second prompt",
			createdAt: Date.now(),
		});
		await act(async () => {
			await current.sendPrompt("Second prompt");
		});
		expect(
			current.messages.filter((message) => message.role === "error"),
		).toHaveLength(0);
		const userMessages = current.messages.filter(
			(message) => message.role === "user",
		);
		expect(userMessages.map((message) => message.content)).toEqual([
			"First prompt",
			"Second prompt",
		]);
	});

	it("shares one cold start and queues a second prompt behind it", async () => {
		let resolveStart: ((value: { sessionId: string }) => void) | undefined;
		const startResponse = new Promise<{ sessionId: string }>((resolve) => {
			resolveStart = resolve;
		});
		const actions: Array<{
			action?: string;
			delivery?: string;
			sessionId?: string;
		}> = [];
		let plannedSessionId = "";
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| {
								action?: string;
								delivery?: string;
								sessionId?: string;
								config?: { sessionId?: string };
						  }
						| undefined;
					actions.push(request ?? {});
					if (request?.action === "start") {
						plannedSessionId = request.config?.sessionId ?? "";
						return await startResponse;
					}
					if (request?.action === "send" && request.delivery === "queue") {
						return { ok: true, queued: true, promptsInQueue: [] };
					}
					if (request?.action === "send") {
						return {
							ok: true,
							result: { text: "First done", finishReason: "completed" },
						};
					}
					return { promptsInQueue: [] };
				}
				return [];
			},
		);

		let firstSend: Promise<void> | undefined;
		let secondSend: Promise<void> | undefined;
		await act(async () => {
			firstSend = current.sendPrompt("First prompt");
			await Promise.resolve();
		});
		await act(async () => {
			secondSend = current.sendPrompt("Second prompt");
			await Promise.resolve();
		});

		expect(
			actions.filter((request) => request.action === "start"),
		).toHaveLength(1);
		expect(current.promptsInQueue.map((item) => item.prompt)).toContain(
			"Second prompt",
		);

		await act(async () => {
			resolveStart?.({ sessionId: plannedSessionId });
			await Promise.all([firstSend, secondSend]);
		});
		const sends = actions.filter((request) => request.action === "send");
		expect(sends).toHaveLength(2);
		expect(sends.map((request) => request.sessionId)).toEqual([
			plannedSessionId,
			plannedSessionId,
		]);
		expect(sends.map((request) => request.delivery)).toEqual([
			undefined,
			"queue",
		]);
	});

	it("preserves prompt order when the first prompt has a slow attachment", async () => {
		let resolveFile: ((value: string) => void) | undefined;
		const fileContent = new Promise<string>((resolve) => {
			resolveFile = resolve;
		});
		const attachment = {
			name: "slow.txt",
			type: "text/plain",
			size: 5,
			lastModified: 1,
			text: vi.fn(async () => await fileContent),
		} as unknown as File;
		const sends: Array<{
			prompt?: string;
			delivery?: string;
			sessionId?: string;
		}> = [];
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| {
								action?: string;
								prompt?: string;
								delivery?: string;
								sessionId?: string;
								config?: { sessionId?: string };
						  }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						sends.push(request);
						return request.delivery === "queue"
							? { ok: true, queued: true, promptsInQueue: [] }
							: {
									ok: true,
									result: { text: "Done", finishReason: "completed" },
								};
					}
					return { promptsInQueue: [] };
				}
				return [];
			},
		);

		let firstSend: Promise<void> | undefined;
		let secondSend: Promise<void> | undefined;
		await act(async () => {
			firstSend = current.sendPrompt("First prompt", [attachment]);
			await Promise.resolve();
		});
		await act(async () => {
			secondSend = current.sendPrompt("Second prompt");
			await Promise.resolve();
		});
		expect(sends).toHaveLength(0);

		await act(async () => {
			resolveFile?.("hello");
			await Promise.all([firstSend, secondSend]);
		});
		expect(sends.map(({ prompt, delivery }) => ({ prompt, delivery }))).toEqual(
			[
				{ prompt: "First prompt", delivery: undefined },
				{ prompt: "Second prompt", delivery: "queue" },
			],
		);
	});

	it("starts a fresh session when a cold start fails and the user retries", async () => {
		let startAttempts = 0;
		const actions: string[] = [];
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					actions.push(request?.action ?? "unknown");
					if (request?.action === "start") {
						startAttempts += 1;
						if (startAttempts === 1) throw new Error("start failed");
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return {
							ok: true,
							result: { text: "Recovered", finishReason: "completed" },
						};
					}
					return { promptsInQueue: [] };
				}
				return [];
			},
		);

		await act(async () => current.sendPrompt("First attempt"));
		expect(current.status).toBe("error");
		await act(async () => current.sendPrompt("Retry"));

		expect(actions.filter((action) => action !== "pending_prompts")).toEqual([
			"start",
			"start",
			"send",
		]);
		expect(
			current.messages.some((message) => message.content === "Recovered"),
		).toBe(true);
	});

	it("falls back to process context when the remembered workspace is stale", async () => {
		await act(async () => root.unmount());
		window.localStorage.setItem(
			"cline.code.workspace-selection.v1",
			JSON.stringify({
				lastWorkspace: "/workspace/deleted",
				workspaces: ["/workspace/deleted"],
			}),
		);
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
			}
			if (command === "validate_workspace_directory") {
				return { valid: false };
			}
			return [];
		});
		root = createRoot(container);
		await act(async () => root.render(<HookHarness />));

		await vi.waitFor(() => {
			expect(current.config.workspaceRoot).toBe("/workspace/cline");
			expect(current.config.cwd).toBe("/workspace/cline");
		});
		expect(invokeMock).toHaveBeenCalledWith("validate_workspace_directory", {
			path: "/workspace/deleted",
		});
	});

	it("applies a remembered workspace that becomes available while process context is loading", async () => {
		await act(async () => root.unmount());
		let resolveContext:
			| ((value: { cwd: string; workspaceRoot: string }) => void)
			| undefined;
		const contextResponse = new Promise<{
			cwd: string;
			workspaceRoot: string;
		}>((resolve) => {
			resolveContext = resolve;
		});
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return await contextResponse;
			}
			if (command === "validate_workspace_directory") {
				return { valid: true };
			}
			return [];
		});
		root = createRoot(container);
		await act(async () => root.render(<HookHarness />));
		await vi.waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("get_process_context");
		});
		window.localStorage.setItem(
			"cline.code.workspace-selection.v1",
			JSON.stringify({
				lastWorkspace: "/workspace/remembered",
				workspaces: ["/workspace/remembered"],
			}),
		);

		await act(async () => {
			resolveContext?.({
				cwd: "/workspace/default",
				workspaceRoot: "/workspace/default",
			});
			await contextResponse;
		});

		await vi.waitFor(() => {
			expect(current.config.workspaceRoot).toBe("/workspace/remembered");
			expect(current.config.cwd).toBe("/workspace/remembered");
		});
		expect(invokeMock).toHaveBeenCalledWith("validate_workspace_directory", {
			path: "/workspace/remembered",
		});
	});

	it("preserves a workspace selected while process context is loading", async () => {
		await act(async () => root.unmount());
		let resolveContext:
			| ((value: { cwd: string; workspaceRoot: string }) => void)
			| undefined;
		const contextResponse = new Promise<{
			cwd: string;
			workspaceRoot: string;
		}>((resolve) => {
			resolveContext = resolve;
		});
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "get_process_context") return await contextResponse;
			return [];
		});
		root = createRoot(container);
		await act(async () => root.render(<HookHarness />));
		await act(async () => {
			current.setWorkspacePath("/workspace/selected");
		});

		await act(async () => {
			resolveContext?.({
				cwd: "/workspace/default",
				workspaceRoot: "/workspace/default",
			});
			await contextResponse;
		});
		expect(current.config.workspaceRoot).toBe("/workspace/selected");
		expect(current.config.cwd).toBe("/workspace/selected");
	});

	it("preserves a chat selection while process context is loading", async () => {
		await act(async () => root.unmount());
		let resolveContext:
			| ((value: { cwd: string; workspaceRoot: string }) => void)
			| undefined;
		const contextResponse = new Promise<{
			cwd: string;
			workspaceRoot: string;
		}>((resolve) => {
			resolveContext = resolve;
		});
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "get_process_context") return await contextResponse;
			return [];
		});
		root = createRoot(container);
		await act(async () => root.render(<HookHarness />));
		await act(async () => {
			current.setWorkspacePath("");
		});

		await act(async () => {
			resolveContext?.({
				cwd: "/workspace/default",
				workspaceRoot: "/workspace/default",
			});
			await contextResponse;
		});
		expect(current.config.workspaceRoot).toBe("");
		expect(current.config.cwd).toBe("");
	});
});
