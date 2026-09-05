// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	appendCappedCommandOutput,
	MAX_LIVE_COMMAND_OUTPUT_CHARS,
} from "@/lib/command-output";
import { MODEL_SELECTION_STORAGE_KEY } from "@/lib/model-selection";
import { mergeCloudSnapshotWithLive, useChatSession } from "./use-chat-session";

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

describe("mergeCloudSnapshotWithLive", () => {
	const message = (
		id: string,
		role: "user" | "assistant",
		content: string,
		createdAt: number,
	) => ({ id, sessionId: "ses-cloud", role, content, createdAt });

	it("reconciles identical optimistic prompts by authoritative count delta", () => {
		const optimisticStates = new Map([
			["optimistic-2", { sessionId: "ses-cloud", state: "pending" as const }],
		]);
		const merged = mergeCloudSnapshotWithLive(
			[
				message("saved-1", "user", "same prompt", 1),
				message("saved-2", "user", "same prompt", 3),
			],
			[
				message("saved-1", "user", "same prompt", 1),
				message("optimistic-2", "user", "same prompt", 2),
			],
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map([["same prompt", 1]]),
				optimisticStates,
			},
		);

		expect(
			merged.filter((item) => item.content === "same prompt"),
		).toHaveLength(2);
		expect(optimisticStates.has("optimistic-2")).toBe(false);
	});

	it("reconciles a wrapped cloud prompt with its optimistic bubble", () => {
		const optimisticStates = new Map([
			["optimistic", { sessionId: "ses-cloud", state: "pending" as const }],
		]);
		const merged = mergeCloudSnapshotWithLive(
			[
				message(
					"saved",
					"user",
					'<user_input mode="act">one prompt</user_input>',
					2,
				),
			],
			[message("optimistic", "user", "one prompt", 1)],
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map(),
				optimisticStates,
			},
		);

		expect(merged.filter((item) => item.role === "user")).toHaveLength(1);
		expect(merged[0]?.id).toBe("saved");
		expect(optimisticStates.has("optimistic")).toBe(false);
	});

	it("keeps a new assistant reply when an older reply has identical text", () => {
		const merged = mergeCloudSnapshotWithLive(
			[message("saved-old", "assistant", "Done", 1)],
			[
				message("live-old", "assistant", "Done", 1),
				message("live-new", "assistant", "Done", 2),
			],
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map(),
				optimisticStates: new Map(),
				preserveUnmatchedLive: true,
			},
		);

		expect(merged.map((item) => item.id)).toEqual(["saved-old", "live-new"]);
	});

	it("keeps optimistic images while a cloud snapshot is temporarily text-only", () => {
		const optimisticStates = new Map([
			["optimistic", { sessionId: "ses-cloud", state: "pending" as const }],
		]);
		const optimistic = {
			...message("optimistic", "user", "describe this", 1),
			images: [
				{
					id: "optimistic-image",
					mediaType: "image/png" as const,
					data: "AQID",
				},
			],
		};
		const first = mergeCloudSnapshotWithLive(
			[message("saved", "user", "describe this", 2)],
			[optimistic],
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map(),
				optimisticStates,
			},
		);

		expect(first).toEqual([
			expect.objectContaining({
				id: "saved",
				images: [expect.objectContaining({ data: "AQID" })],
			}),
		]);
		expect(optimisticStates.has("optimistic")).toBe(false);

		const second = mergeCloudSnapshotWithLive(
			[message("saved", "user", "describe this", 2)],
			first,
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map([["describe this", 1]]),
				optimisticStates,
			},
		);
		expect(second[0]?.images?.[0]?.data).toBe("AQID");
	});

	it("keeps a failed optimistic prompt during the first hydrate", () => {
		const optimisticStates = new Map([
			["failed-prompt", { sessionId: "ses-cloud", state: "failed" as const }],
		]);
		const merged = mergeCloudSnapshotWithLive(
			[message("older", "user", "repeat", 1)],
			[message("failed-prompt", "user", "repeat", 2)],
			{
				sessionId: "ses-cloud",
				transcriptKnown: false,
				previousUserCounts: new Map(),
				optimisticStates,
			},
		);

		expect(merged.map((item) => item.id)).toEqual(["older", "failed-prompt"]);
	});

	it("does not consume a pending prompt before a transcript baseline exists", () => {
		const optimisticStates = new Map([
			["pending-prompt", { sessionId: "ses-cloud", state: "pending" as const }],
		]);
		const merged = mergeCloudSnapshotWithLive(
			[message("older", "user", "repeat", 1)],
			[message("pending-prompt", "user", "repeat", 2)],
			{
				sessionId: "ses-cloud",
				transcriptKnown: false,
				previousUserCounts: new Map(),
				optimisticStates,
			},
		);

		expect(merged.map((item) => item.id)).toEqual(["older", "pending-prompt"]);
	});

	it("keeps a pending bubble when the snapshot has not reflected it yet", () => {
		// Baseline and snapshot agree (count 1 for this content), so the
		// reflected-prompt budget is zero and the pending optimistic bubble
		// must survive the merge; consuming it would make an in-flight
		// duplicate prompt vanish from the transcript.
		const optimisticStates = new Map([
			["pending-dup", { sessionId: "ses-cloud", state: "pending" as const }],
		]);
		const merged = mergeCloudSnapshotWithLive(
			[message("saved-1", "user", "same prompt", 1)],
			[
				message("saved-1", "user", "same prompt", 1),
				message("pending-dup", "user", "same prompt", 2),
			],
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map([["same prompt", 1]]),
				optimisticStates,
			},
		);

		expect(merged.map((item) => item.id)).toEqual(["saved-1", "pending-dup"]);
		expect(optimisticStates.has("pending-dup")).toBe(true);
	});

	it("consumes exactly one pending bubble per newly reflected copy", () => {
		// Two pending bubbles, but the snapshot only grew by one copy since
		// the previous baseline: exactly one bubble is consumed, the other
		// stays visible.
		const optimisticStates = new Map([
			["pending-a", { sessionId: "ses-cloud", state: "pending" as const }],
			["pending-b", { sessionId: "ses-cloud", state: "pending" as const }],
		]);
		const merged = mergeCloudSnapshotWithLive(
			[
				message("saved-1", "user", "same prompt", 1),
				message("saved-2", "user", "same prompt", 3),
			],
			[
				message("saved-1", "user", "same prompt", 1),
				message("pending-a", "user", "same prompt", 2),
				message("pending-b", "user", "same prompt", 4),
			],
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map([["same prompt", 1]]),
				optimisticStates,
			},
		);

		expect(
			merged.filter((item) => item.content === "same prompt"),
		).toHaveLength(3);
		expect(optimisticStates.size).toBe(1);
	});

	it("keeps error bubbles when dropping unmatched live messages", () => {
		const merged = mergeCloudSnapshotWithLive(
			[message("saved", "assistant", "the answer", 1)],
			[
				{
					id: "stale-assistant",
					sessionId: "ses-cloud",
					role: "assistant" as const,
					content: "unrelated partial",
					createdAt: 2,
				},
				{
					id: "error-bubble",
					sessionId: "ses-cloud",
					role: "error" as const,
					content: "The send failed",
					createdAt: 3,
				},
			],
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map(),
				optimisticStates: new Map(),
				preserveUnmatchedLive: false,
			},
		);

		expect(merged.map((item) => item.id)).toEqual(["saved", "error-bubble"]);
	});

	it("drops an earlier partial assistant message included by the snapshot", () => {
		const merged = mergeCloudSnapshotWithLive(
			[message("saved", "assistant", "the complete answer", 2)],
			[message("partial", "assistant", "the complete", 1)],
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map(),
				optimisticStates: new Map(),
			},
		);

		expect(merged.map((item) => item.id)).toEqual(["saved"]);
	});

	it("replaces a live tool card with its completed snapshot by tool call id", () => {
		const merged = mergeCloudSnapshotWithLive(
			[
				{
					id: "saved-tool",
					sessionId: "ses-cloud",
					role: "tool",
					content: '{"toolName":"read_files","output":"done"}',
					createdAt: 2,
					meta: { toolCallId: "call-1" },
				},
			],
			[
				{
					id: "live-tool",
					sessionId: "ses-cloud",
					role: "tool",
					content: '{"toolName":"read_files","output":null}',
					createdAt: 1,
					meta: { toolCallId: "call-1" },
				},
			],
			{
				sessionId: "ses-cloud",
				transcriptKnown: true,
				previousUserCounts: new Map(),
				optimisticStates: new Map(),
				preserveUnmatchedLive: true,
			},
		);

		expect(merged.map((message) => message.id)).toEqual(["saved-tool"]);
	});
});

let container: HTMLDivElement;
let root: Root;
let current: ChatSessionHook;

function HookHarness() {
	current = useChatSession();
	return null;
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

function handlerFor(eventName: string): (payload: unknown) => void {
	const handler = subscribeMock.mock.calls.find(
		([subscribedEvent]) => subscribedEvent === eventName,
	)?.[1];
	expect(handler).toBeDefined();
	return handler as (payload: unknown) => void;
}

beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	if (typeof window.localStorage.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
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
	it("allows cloud provisioning to outlive the default desktop command timeout", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
			}
			if (command === "chat_session_command") {
				return {
					sessionId: "ses-cloud",
					cwd: "/workspace",
					workspaceRoot: "/workspace",
				};
			}
			return [];
		});

		await act(async () =>
			current.start({
				...current.config,
				executionTarget: "cloud",
				repoUrl: "https://github.com/cline/test",
				provider: "cline",
			}),
		);

		expect(invokeMock).toHaveBeenCalledWith(
			"chat_session_command",
			{
				request: expect.objectContaining({
					action: "start",
					config: expect.objectContaining({ executionTarget: "cloud" }),
				}),
			},
			{ timeoutMs: null },
		);
	});

	it("restores an idle parent when aborting its child fails", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "start") {
						return { sessionId: "session-child-abort" };
					}
					if (request?.action === "abort") {
						return { ok: false };
					}
				}
				return [];
			},
		);

		await act(async () => current.start(current.config));
		const statusHandler = handlerFor("chat_session_status");

		await act(async () => {
			statusHandler({ sessionId: current.sessionId, status: "idle" });
		});
		expect(current.status).toBe("idle");

		await act(async () => current.abort());

		expect(current.status).toBe("idle");
	});

	it("preserves authoritative completion across abort races", async () => {
		vi.useFakeTimers();
		try {
			const sessionId = "session-abort-chat-done";
			const abortResponse = deferred<unknown>();
			const pendingResponse = deferred<unknown>();
			const sendResponse = deferred<unknown>();
			invokeMock.mockImplementation(
				async (command: string, args?: Record<string, unknown>) => {
					if (command === "chat_session_command") {
						const request = args?.request as { action?: string } | undefined;
						if (request?.action === "start") return { sessionId };
						if (request?.action === "send") {
							return await sendResponse.promise;
						}
						if (request?.action === "abort") {
							return await abortResponse.promise;
						}
						if (request?.action === "pending_prompts") {
							return await pendingResponse.promise;
						}
					}
					return [];
				},
			);

			await act(async () => current.start(current.config));
			const chatEventHandler = handlerFor("chat_event");
			const statusHandler = handlerFor("chat_session_status");

			await act(async () => {
				statusHandler({ sessionId, status: "running" });
			});
			let sendTask!: Promise<void>;
			await act(async () => {
				sendTask = current.sendPrompt("queued follow-up");
				for (let i = 0; i < 5; i += 1) await Promise.resolve();
			});

			await act(async () => {
				chatEventHandler({
					sessionId,
					stream: "chat_done",
					chunk: JSON.stringify({ reason: "completed" }),
					ts: Date.now(),
					index: 1,
				});
			});
			expect(current.status).toBe("running");

			let abortTask!: Promise<void>;
			await act(async () => {
				abortTask = current.abort();
				await Promise.resolve();
			});
			expect(current.status).toBe("stopping");

			await act(async () => {
				statusHandler({ sessionId, status: "running" });
			});
			expect(current.status).toBe("stopping");

			await act(async () => {
				pendingResponse.resolve({
					sessionId,
					ok: true,
					promptsInQueue: [],
				});
				for (let i = 0; i < 5; i += 1) await Promise.resolve();
			});
			expect(current.status).toBe("completed");

			await act(async () => {
				await vi.advanceTimersByTimeAsync(2000);
			});
			expect(current.status).toBe("completed");

			await act(async () => {
				sendResponse.resolve({
					sessionId,
					ok: true,
					queued: true,
					promptsInQueue: [],
				});
				await sendTask;
			});
			expect(current.status).toBe("completed");

			await act(async () => {
				abortResponse.resolve({ ok: false });
				await abortTask;
			});
			expect(current.status).toBe("completed");
		} finally {
			vi.useRealTimers();
		}
	});

	it("reconciles a running tool row after an aborted send settles", async () => {
		const sessionId = "session-aborted-tool";
		const sendResponse = deferred<unknown>();
		const canonicalMessages = [
			{
				id: "history-assistant",
				sessionId,
				role: "assistant",
				content: "",
				createdAt: 2,
			},
			{
				id: "history-tool",
				sessionId,
				role: "tool",
				content: JSON.stringify({
					toolName: "spawn_agent",
					input: { task: "sleep" },
					result: { finishReason: "aborted" },
					isError: false,
				}),
				createdAt: 3,
				meta: {
					toolName: "spawn_agent",
					toolCallId: "call-spawn",
					hookEventName: "history_tool_result",
				},
			},
		];
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "read_session_messages") return canonicalMessages;
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "start") {
						return { sessionId };
					}
					if (request?.action === "send") {
						return await sendResponse.promise;
					}
					if (request?.action === "abort") return { sessionId, ok: true };
				}
				return [];
			},
		);

		await act(async () => current.start(current.config));
		const chatEventHandler = handlerFor("chat_event");

		let sendTask!: Promise<void>;
		await act(async () => {
			sendTask = current.sendPrompt("spawn a subagent");
			await Promise.resolve();
			chatEventHandler?.({
				sessionId,
				stream: "chat_tool_call_start",
				chunk: JSON.stringify({
					toolCallId: "call-spawn",
					toolName: "spawn_agent",
					input: { task: "sleep" },
				}),
				ts: Date.now(),
				index: 1,
			});
		});
		expect(
			current.messages.find((message) => message.role === "tool")?.meta
				?.hookEventName,
		).toBe("tool_call_start");

		await act(async () => current.abort());
		await act(async () => {
			sendResponse.resolve({
				ok: true,
				result: { finishReason: "aborted" },
			});
			await sendTask;
			await new Promise((resolve) => setTimeout(resolve, 300));
		});

		expect(current.status).toBe("cancelled");
		const toolMessage = current.messages.find(
			(message) => message.role === "tool",
		);
		expect(toolMessage?.meta?.hookEventName).toBe("history_tool_result");
		expect(JSON.parse(toolMessage?.content ?? "{}").result).toEqual({
			finishReason: "aborted",
		});
	});

	it("caps command output while preserving the newest tail", () => {
		const result = appendCappedCommandOutput(
			"head\n",
			`${"x".repeat(MAX_LIVE_COMMAND_OUTPUT_CHARS)}tail`,
		);
		expect(result.truncated).toBe(true);
		expect(result.output.length).toBeLessThanOrEqual(
			MAX_LIVE_COMMAND_OUTPUT_CHARS,
		);
		expect(
			result.output.startsWith("\u001b[0m[Earlier command output truncated]"),
		).toBe(true);
		expect(result.output.endsWith("tail")).toBe(true);
	});

	it("coalesces live command updates and exposes detach by tool call", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return {
						cwd: "/workspace/cline",
						workspaceRoot: "/workspace/cline",
					};
				}
				if (command === "proceed_while_running") {
					return { detachedCount: 1 };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: { sessionId?: string } }
						| undefined;
					if (request?.action === "start") {
						return {
							sessionId: request.config?.sessionId ?? "session-output",
							cwd: "/workspace/cline",
							workspaceRoot: "/workspace/cline",
						};
					}
				}
				return [];
			},
		);
		await act(async () => current.start(current.config));
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const longAnsiOutput = `\u001b[31m${"x".repeat(
			MAX_LIVE_COMMAND_OUTPUT_CHARS + 100,
		)}tail\u001b[0m`;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_tool_call_start",
				chunk: JSON.stringify({
					toolCallId: "call-output",
					toolName: "run_commands",
					input: { commands: ["bun test"] },
				}),
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_tool_call_update",
				chunk: JSON.stringify({
					toolCallId: "call-output",
					toolName: "run_commands",
					update: {
						stream: "stdout",
						chunk: longAnsiOutput,
						detachable: true,
					},
				}),
				ts: Date.now(),
				index: 2,
			});
			await new Promise((resolve) => setTimeout(resolve, 60));
		});

		const toolMessage = current.messages.find(
			(message) => message.role === "tool",
		);
		expect(toolMessage?.meta).toMatchObject({
			toolCallId: "call-output",
			toolDetachable: true,
			toolOutputTruncated: true,
		});
		expect(toolMessage?.meta?.toolOutput?.length).toBeLessThanOrEqual(
			MAX_LIVE_COMMAND_OUTPUT_CHARS,
		);
		expect(toolMessage?.meta?.toolOutput).toContain("tail\u001b[0m");

		if (!current.sessionId) throw new Error("Expected active session");
		await act(async () =>
			current.proceedWhileRunning(current.sessionId as string, "call-output"),
		);
		expect(invokeMock).toHaveBeenCalledWith("proceed_while_running", {
			sessionId: current.sessionId,
			toolCallId: "call-output",
		});
	});

	it("heals a running attached session with a dead event stream by polling history", async () => {
		// Scheduled runs can execute on a host whose live events never reach
		// this client; the transcript must still settle without a remount.
		const hydratedSessionId = "session-dead-stream";
		let readCount = 0;
		let recordReads = 0;
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					readCount += 1;
					const base = [
						{
							id: "history-user",
							sessionId: hydratedSessionId,
							role: "user",
							content: "tell me the current time",
							createdAt: 1,
						},
					];
					return readCount === 1
						? base
						: [
								...base,
								{
									id: "history-answer",
									sessionId: hydratedSessionId,
									role: "assistant",
									content: "It is 12:28 PM PT.",
									createdAt: 2,
								},
							];
				}
				if (command === "get_discovered_session") {
					recordReads += 1;
					// Still running on the first poll — the snapshot already
					// ends on assistant narration, which must NOT read as
					// finished while the record says running.
					return {
						sessionId: hydratedSessionId,
						status: recordReads === 1 ? "running" : "completed",
					};
				}
				if (command === "read_session_hooks") return [];
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "attach") {
						return {
							sessionId: hydratedSessionId,
							status: "running",
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

		// Fake timers must be active before hydration so the fallback's
		// interval registers on the fake clock.
		vi.useFakeTimers();
		try {
			await act(async () => {
				await current.hydrateSession({
					sessionId: hydratedSessionId,
					status: "running",
					provider: "cline",
					model: "test-model",
					cwd: "/workspace/cline",
					workspaceRoot: "/workspace/cline",
					startedAt: "2026-08-12T00:00:00.000Z",
				});
			});
			expect(current.status).toBe("running");
			expect(current.messages).toHaveLength(1);

			// No chat_event chunks arrive. The first poll surfaces the
			// narration mid-run; the record still says running, and the
			// record — not transcript shape — decides the status.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(3_100);
			});
			expect(current.messages).toHaveLength(2);
			expect(current.messages[1]?.content).toBe("It is 12:28 PM PT.");
			expect(current.status).toBe("running");

			// The record flips to completed; the next poll mirrors it.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(3_100);
			});
		} finally {
			vi.useRealTimers();
		}

		expect(current.status).toBe("completed");
	});

	it("keeps the stale-stream poll inert while a local turn is in flight", async () => {
		// Regression: the fallback poll replaced an optimistic user bubble
		// (raw prompt) with its canonical envelope-wrapped twin, desyncing
		// the rekey bookkeeping so the stream appended a duplicate bubble.
		const hydratedSessionId = "session-local-turn";
		let readCount = 0;
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					readCount += 1;
					return [
						{
							id: "history-user",
							sessionId: hydratedSessionId,
							role: "user",
							content: "earlier prompt",
							createdAt: 1,
						},
					];
				}
				if (command === "get_discovered_session") {
					return { sessionId: hydratedSessionId, status: "running" };
				}
				if (command === "read_session_hooks") return [];
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "attach" || request?.action === "start") {
						return {
							sessionId: hydratedSessionId,
							status: "idle",
							provider: "cline",
							model: "test-model",
							cwd: "/workspace/cline",
							workspaceRoot: "/workspace/cline",
						};
					}
					if (request?.action === "send") {
						// Keep the send unresolved: the local turn stays in
						// flight for the whole test.
						return await new Promise(() => {});
					}
					return { promptsInQueue: [] };
				}
				return [];
			},
		);

		vi.useFakeTimers();
		try {
			await act(async () => {
				await current.hydrateSession({
					sessionId: hydratedSessionId,
					status: "idle",
					provider: "cline",
					model: "test-model",
					cwd: "/workspace/cline",
					workspaceRoot: "/workspace/cline",
					startedAt: "2026-08-12T00:00:00.000Z",
				});
			});
			const readsAfterHydration = readCount;

			await act(async () => {
				void current.sendPrompt("what time is it");
				await Promise.resolve();
			});
			expect(current.status).toBe("starting");
			expect(
				current.messages.filter((m) => m.content === "what time is it"),
			).toHaveLength(1);

			// Model produces nothing for a long quiet window; the poll must
			// not fire while the local turn is unsettled.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(10_000);
			});
			expect(readCount).toBe(readsAfterHydration);
			expect(
				current.messages.filter((m) => m.content === "what time is it"),
			).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("routes command updates after attaching to an in-flight tool call", async () => {
		const hydratedSessionId = "session-in-flight-command";
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return [
						{
							id: "history-tool-call",
							sessionId: hydratedSessionId,
							role: "tool",
							content: JSON.stringify({
								toolName: "run_commands",
								input: { commands: ["bun test"] },
								result: null,
								isError: false,
							}),
							createdAt: 1,
							meta: {
								toolName: "run_commands",
								toolCallId: "call-in-flight",
								hookEventName: "history_tool_use",
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
							status: "running",
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
				status: "running",
				provider: "cline",
				model: "test-model",
				cwd: "/workspace/cline",
				workspaceRoot: "/workspace/cline",
				startedAt: "2026-08-12T00:00:00.000Z",
			});
		});

		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		await act(async () => {
			chatEventHandler?.({
				sessionId: hydratedSessionId,
				stream: "chat_tool_call_update",
				chunk: JSON.stringify({
					toolCallId: "call-in-flight",
					toolName: "run_commands",
					update: { stream: "stdout", chunk: "still running\n" },
				}),
				ts: Date.now(),
				index: 1,
			});
			await new Promise((resolve) => setTimeout(resolve, 60));
		});

		expect(current.messages).toHaveLength(1);
		expect(current.messages[0]?.meta?.toolOutput).toBe("still running\n");

		await act(async () => {
			chatEventHandler?.({
				sessionId: hydratedSessionId,
				stream: "chat_tool_call_end",
				chunk: JSON.stringify({
					toolCallId: "call-in-flight",
					toolName: "run_commands",
					output: "done",
				}),
				ts: Date.now(),
				index: 2,
			});
		});

		const completedPayload = JSON.parse(current.messages[0]?.content ?? "{}");
		expect(completedPayload).toMatchObject({
			input: { commands: ["bun test"] },
			result: "done",
		});
		expect(current.messages[0]?.meta?.hookEventName).toBe("tool_call_end");
	});

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
		// On success result.text is assistant content; on a failed run it is
		// the runtime's error string and must surface as an error message
		// (assistant bubbles for unpersisted turns are wiped by rehydration).
		{
			finishReason: "completed",
			expectedRole: "assistant",
			expected:
				'[{"code":"too_small","path":["workspaces","/","hint"],"message":"expected string to have >=1 characters"}]',
		},
		{
			finishReason: "error",
			expectedRole: "error",
			expected:
				'[{"code":"too_small","path":["workspaces","/","hint"],"message":"expected string to have >=1 characters"}]',
		},
	])("handles schema-like assistant text for $finishReason responses", async ({
		finishReason,
		expectedRole,
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

		// Error-role content goes through the turn-failure reporter, which
		// wraps the detail in user-facing copy — assert containment, not
		// equality, so the schema text is preserved either way.
		expect(
			current.messages.findLast((message) => message.role === expectedRole)
				?.content,
		).toContain(expected);
	});

	it("keeps a recovered cloud turn running after a transport reconnect", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return [];
				}
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "start") {
						return {
							sessionId: "ses-cloud",
							cwd: "/workspace",
							workspaceRoot: "/workspace",
						};
					}
					if (request?.action === "send") {
						return {
							ok: true,
							recoveredAfterDisconnect: true,
							status: "running",
						};
					}
				}
				return [];
			},
		);

		await act(async () =>
			current.start({
				...current.config,
				executionTarget: "cloud",
				provider: "cline",
				repoUrl: "https://github.com/cline/test",
			}),
		);
		await act(async () => current.sendPrompt("Keep working"));

		expect(current.status).toBe("running");
		expect(current.error).toBeNull();
	});

	it("retains the first cloud prompt's bubble across a lagging rehydration snapshot", async () => {
		let startPrompt = "";
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return [];
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; prompt?: string }
						| undefined;
					if (request?.action === "start") {
						startPrompt = request.prompt ?? "";
						// A cloud create returns a server-assigned id, never the
						// client-planned one.
						return {
							sessionId: "ses-cloud",
							cwd: "/workspace",
							workspaceRoot: "/workspace",
						};
					}
					if (request?.action === "send") {
						return {
							ok: true,
							result: { text: "On it", finishReason: "completed" },
						};
					}
				}
				return [];
			},
		);

		await act(async () => {
			current.setConfig((previous) => ({
				...previous,
				executionTarget: "cloud",
				provider: "cline",
				repoUrl: "https://github.com/cline/test",
			}));
		});
		// The send itself creates the session, so the optimistic bubble is
		// born under the client-planned id and must be re-keyed to ses-cloud.
		await act(async () => current.sendPrompt("build the feature"));
		expect(startPrompt).toBe("build the feature");

		const rehydratedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "cloud_session_rehydrated",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(rehydratedHandler).toBeDefined();

		// A rehydration snapshot that lags the just-sent prompt (assistant
		// reply only) must not erase the prompt bubble.
		await act(async () => {
			rehydratedHandler?.({
				sessionId: "ses-cloud",
				status: "running",
				transcriptKnown: true,
				messages: [
					{
						id: "assistant-1",
						sessionId: "ses-cloud",
						role: "assistant",
						content: "On it",
						createdAt: Date.now(),
					},
				],
			});
			await Promise.resolve();
		});

		expect(
			current.messages
				.filter((message) => message.role === "user")
				.map((message) => message.content),
		).toContain("build the feature");
	});

	it("hydrates the initial prompt from a provisioning attach", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return [];
				}
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "attach") {
						return {
							sessionId: "cloud-provisioning-test",
							status: "provisioning",
							provider: "cline",
							model: "test-model",
							cwd: "/workspace",
							workspaceRoot: "/workspace",
							prompt: "Fix the provisioning flow",
						};
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.hydrateSession({
				sessionId: "cloud-provisioning-test",
				origin: "cloud",
				repoUrl: "https://github.com/cline/test",
				status: "provisioning",
				provider: "cline",
				model: "test-model",
				cwd: "/workspace",
				workspaceRoot: "/workspace",
				startedAt: "2026-08-17T00:00:00.000Z",
			});
		});

		expect(current.messages).toEqual([
			expect.objectContaining({
				role: "user",
				content: "Fix the provisioning flow",
			}),
		]);
	});

	it("replaces the first cloud prompt with its canonical snapshot copy", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return [
						{
							id: "saved-first-prompt",
							sessionId: "ses-cloud",
							role: "user",
							content: "build the feature",
							createdAt: Date.now(),
						},
					];
				}
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "start") {
						return {
							sessionId: "ses-cloud",
							cwd: "/workspace",
							workspaceRoot: "/workspace",
						};
					}
					if (request?.action === "send") {
						return { ok: true, result: { finishReason: "completed" } };
					}
				}
				return [];
			},
		);

		await act(async () => {
			current.setConfig((previous) => ({
				...previous,
				executionTarget: "cloud",
				provider: "cline",
				repoUrl: "https://github.com/cline/test",
			}));
		});
		await act(async () => current.sendPrompt("build the feature"));

		expect(
			current.messages.filter(
				(message) =>
					message.role === "user" && message.content === "build the feature",
			),
		).toHaveLength(1);
	});

	it("hydrates state missed during a passive cloud reconnect", async () => {
		invokeMock.mockImplementation(
			async (command: string, _args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					return {
						sessionId: "ses-cloud",
						cwd: "/workspace",
						workspaceRoot: "/workspace",
					};
				}
				if (command === "read_session_messages") {
					return [
						{
							id: "assistant-recovered",
							sessionId: "ses-cloud",
							role: "assistant",
							content: "Finished while reconnecting",
							createdAt: Date.now(),
						},
					];
				}
				return [];
			},
		);
		await act(async () => {
			await current.start({
				...current.config,
				executionTarget: "cloud",
				provider: "cline",
				repoUrl: "https://github.com/cline/test",
			});
		});
		const rehydratedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "cloud_session_rehydrated",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const endedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_session_ended",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(rehydratedHandler).toBeDefined();

		await act(async () => {
			rehydratedHandler?.({ sessionId: "ses-cloud", status: "completed" });
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(current.messages.at(-1)?.content).toBe(
			"Finished while reconnecting",
		);
		expect(current.status).toBe("completed");

		await act(async () => {
			endedHandler?.({ sessionId: "ses-cloud", reason: "completed" });
			rehydratedHandler?.({
				sessionId: "ses-cloud",
				status: "running",
				transcriptKnown: true,
				messages: [
					{
						id: "remote-user",
						sessionId: "ses-cloud",
						role: "user",
						content: "Started elsewhere",
						createdAt: Date.now(),
					},
				],
			});
		});
		expect(current.status).toBe("running");
	});

	it("keeps the reconciled live tail when the duplicate history RPC resolves", async () => {
		let resolveHistory!: (messages: Array<Record<string, unknown>>) => void;
		let historyRequested!: () => void;
		const requested = new Promise<void>((resolve) => {
			historyRequested = resolve;
		});
		const history = new Promise<Array<Record<string, unknown>>>((resolve) => {
			resolveHistory = resolve;
		});
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
			}
			if (command === "read_session_messages") {
				historyRequested();
				return await history;
			}
			if (command === "chat_session_command") {
				return {
					sessionId: "ses-cloud",
					status: "running",
					cwd: "/workspace",
					workspaceRoot: "/workspace",
				};
			}
			return [];
		});

		let hydration!: Promise<void>;
		await act(async () => {
			hydration = current.hydrateSession({
				sessionId: "ses-cloud",
				origin: "cloud",
				repoUrl: "https://github.com/cline/test",
				status: "running",
				provider: "cline",
				model: "test-model",
				cwd: "/workspace",
				workspaceRoot: "/workspace",
				startedAt: "2026-08-06T00:00:00.000Z",
			});
			await requested;
		});

		const rehydratedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "cloud_session_rehydrated",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const snapshot = [
			{
				id: "saved-assistant",
				sessionId: "ses-cloud",
				role: "assistant",
				content: "Saved answer",
				createdAt: 1,
			},
		];

		await act(async () => {
			rehydratedHandler?.({
				sessionId: "ses-cloud",
				status: "running",
				transcriptKnown: true,
				messages: snapshot,
			});
			chatEventHandler?.({
				sessionId: "ses-cloud",
				stream: "chat_tool_call_start",
				chunk: JSON.stringify({
					toolCallId: "tail-tool",
					toolName: "read_files",
					input: { paths: ["README.md"] },
				}),
				ts: 2,
				index: 1,
			});
			resolveHistory(snapshot);
			await hydration;
		});

		expect(current.messages.map((message) => message.role)).toEqual([
			"assistant",
			"tool",
		]);
		expect(current.messages.at(-1)?.content).toContain("read_files");
	});

	it("keeps live assistant and tool routing across a running cloud snapshot", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
			}
			if (command === "chat_session_command") {
				return {
					sessionId: "ses-cloud",
					cwd: "/workspace",
					workspaceRoot: "/workspace",
				};
			}
			return [];
		});
		await act(async () => {
			await current.start({
				...current.config,
				executionTarget: "cloud",
				provider: "cline",
				repoUrl: "https://github.com/cline/test",
			});
		});
		const rehydratedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "cloud_session_rehydrated",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: "ses-cloud",
				stream: "chat_text",
				chunk: "Hel",
				ts: 1,
				index: 1,
			});
			chatEventHandler?.({
				sessionId: "ses-cloud",
				stream: "chat_core_log",
				chunk: "flush",
				ts: 2,
				index: 2,
			});
			rehydratedHandler?.({
				sessionId: "ses-cloud",
				status: "running",
				transcriptKnown: true,
				messages: [
					{
						id: "saved-assistant",
						sessionId: "ses-cloud",
						role: "assistant",
						content: "Hello",
						createdAt: 1,
					},
				],
			});
			chatEventHandler?.({
				sessionId: "ses-cloud",
				stream: "chat_text",
				chunk: "!",
				ts: 3,
				index: 3,
			});
			chatEventHandler?.({
				sessionId: "ses-cloud",
				stream: "chat_core_log",
				chunk: "flush",
				ts: 4,
				index: 4,
			});
		});
		expect(
			current.messages.filter((message) => message.role === "assistant"),
		).toEqual([expect.objectContaining({ content: "Hello!" })]);

		await act(async () => {
			chatEventHandler?.({
				sessionId: "ses-cloud",
				stream: "chat_tool_call_start",
				chunk: JSON.stringify({
					toolCallId: "tool-1",
					toolName: "read_files",
					input: { paths: ["README.md"] },
				}),
				ts: 5,
				index: 5,
			});
			rehydratedHandler?.({
				sessionId: "ses-cloud",
				status: "running",
				transcriptKnown: true,
				messages: [
					{
						id: "saved-assistant",
						sessionId: "ses-cloud",
						role: "assistant",
						content: "Hello",
						createdAt: 1,
					},
					{
						id: "saved-tool",
						sessionId: "ses-cloud",
						role: "tool",
						content: JSON.stringify({
							toolName: "read_files",
							input: {},
							result: null,
						}),
						createdAt: 5,
						meta: {
							toolCallId: "tool-1",
							toolName: "read_files",
							hookEventName: "tool_call_start",
						},
					},
				],
			});
			chatEventHandler?.({
				sessionId: "ses-cloud",
				stream: "chat_tool_call_end",
				chunk: JSON.stringify({
					toolCallId: "tool-1",
					toolName: "read_files",
					output: "done",
				}),
				ts: 6,
				index: 6,
			});
		});
		expect(current.messages.find((message) => message.role === "tool")).toEqual(
			expect.objectContaining({
				meta: expect.objectContaining({ hookEventName: "tool_call_end" }),
			}),
		);
	});

	it("keeps an attached running cloud session running after hydration", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return [
						{
							id: "assistant-running",
							sessionId: "ses-cloud",
							role: "assistant",
							content: "Still working",
							createdAt: Date.now(),
						},
					];
				}
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "attach") {
						return {
							sessionId: "ses-cloud",
							status: "running",
							provider: "cline",
							model: "test-model",
							cwd: "/workspace",
							workspaceRoot: "/workspace",
						};
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.hydrateSession({
				sessionId: "ses-cloud",
				origin: "cloud",
				repoUrl: "https://github.com/cline/test",
				status: "running",
				provider: "cline",
				model: "test-model",
				cwd: "/workspace",
				workspaceRoot: "/workspace",
				startedAt: "2026-08-06T00:00:00.000Z",
			});
		});

		expect(current.status).toBe("running");
	});

	it("restores a cloud session's persisted branch during hydration", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return [];
				}
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "attach") {
						return {
							sessionId: "ses-cloud",
							status: "completed",
							provider: "cline",
							model: "test-model",
							cwd: "/workspace",
							workspaceRoot: "/workspace",
						};
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.hydrateSession({
				sessionId: "ses-cloud",
				origin: "cloud",
				repoUrl: "https://github.com/cline/test",
				status: "completed",
				provider: "cline",
				model: "test-model",
				cwd: "/workspace",
				workspaceRoot: "/workspace",
				startedAt: "2026-08-05T00:00:00.000Z",
				metadata: {
					git: {
						url: "https://github.com/cline/test",
						branch: "feature/cloud",
					},
				},
			});
		});

		expect(current.config.branch).toBe("feature/cloud");
	});

	it("keeps an approval actionable when the remote acknowledgement fails", async () => {
		invokeMock.mockImplementation(
			async (command: string, _args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					return {
						sessionId: "ses-cloud",
						cwd: "/workspace",
						workspaceRoot: "/workspace",
					};
				}
				if (command === "poll_tool_approvals") {
					return [];
				}
				if (command === "respond_tool_approval") {
					throw new Error("approval acknowledgement failed");
				}
				return [];
			},
		);

		await act(async () => {
			await current.start({
				...current.config,
				executionTarget: "cloud",
				repoUrl: "https://github.com/cline/test",
				provider: "cline",
			});
		});
		const approvalHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "tool_approval_state",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(approvalHandler).toBeDefined();

		await act(async () => {
			approvalHandler?.({
				sessionId: "ses-cloud",
				items: [
					{
						requestId: "approval-1",
						sessionId: "ses-cloud",
						toolCallId: "tool-1",
						toolName: "run_commands",
						input: { command: "git status" },
					},
				],
			});
		});
		expect(current.pendingToolApprovals).toHaveLength(1);

		await act(async () => {
			await current.approveToolApproval("approval-1");
		});

		expect(current.pendingToolApprovals).toHaveLength(1);
		expect(current.error).toContain("approval acknowledgement failed");
		expect(current.status).toBe("idle");
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

	it("resumes rendering when a queued prompt runs after an abort", async () => {
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
					return { ok: true, prompts: [] };
				}
				return [];
			},
		);

		await act(async () => current.sendPrompt("First prompt"));
		await act(async () => current.abort());
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const statusHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_session_status",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_text",
				chunk: "stale assistant text",
				ts: Date.now(),
				index: 1,
			});
		});
		expect(
			current.messages.some((message) =>
				message.content.includes("stale assistant text"),
			),
		).toBe(false);

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_queued_prompt_start",
				chunk: JSON.stringify({
					promptId: "drained-1",
					prompt: "queued before abort",
				}),
				ts: Date.now(),
				index: 2,
			});
			statusHandler?.({ sessionId: current.sessionId, status: "running" });
		});
		expect(current.status).toBe("running");
		expect(
			current.messages.find(
				(message) => message.id === "queued_user_drained-1",
			),
		).toMatchObject({ content: "queued before abort" });
	});

	it("appends live generated images to the active assistant message", async () => {
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
		await act(async () => current.sendPrompt("Draw a lighthouse"));
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_text",
				chunk: "Here it is.",
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_media",
				chunk: JSON.stringify({
					id: "generated-1",
					modality: "image",
					mediaType: "image/webp",
					source: { type: "base64", data: "aGVsbG8=" },
				}),
				ts: Date.now(),
				index: 2,
			});
		});

		const assistantMessages = current.messages.filter(
			(message) => message.role === "assistant",
		);
		expect(assistantMessages).toEqual([
			expect.objectContaining({ content: "Here it is." }),
			expect.objectContaining({
				media: [
					expect.objectContaining({
						id: "generated-1",
						mediaType: "image/webp",
					}),
				],
			}),
		]);
	});

	it("deduplicates repeated live generated image events", async () => {
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
		await act(async () => current.sendPrompt("Draw three puppies"));
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			for (const [index, media] of [
				{ id: "generated-1", data: "aGVsbG8=" },
				{ id: "generated-1", data: "aGVsbG8=" },
				{ id: "generated-2", data: "d29ybGQ=" },
			].entries()) {
				chatEventHandler?.({
					sessionId: current.sessionId,
					stream: "chat_media",
					chunk: JSON.stringify({
						id: media.id,
						modality: "image",
						mediaType: "image/webp",
						source: { type: "base64", data: media.data },
					}),
					ts: Date.now(),
					index: index + 1,
				});
			}
		});

		expect(
			current.messages.flatMap((message) =>
				(message.media ?? []).map((media) => media.id),
			),
		).toEqual(["generated-1", "generated-2"]);
	});

	it("renders generated images returned in the completed RPC result", async () => {
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
						return { sessionId: request.config?.sessionId ?? "session-test" };
					}
					if (request?.action === "send") {
						return {
							ok: true,
							result: {
								text: "",
								finishReason: "completed",
								messages: [
									{
										role: "assistant",
										content: [
											{
												type: "image",
												data: "aGVsbG8=",
												mediaType: "image/png",
											},
										],
									},
								],
							},
						};
					}
				}
				if (command === "read_session_messages") {
					return [
						{
							id: "persisted-user",
							sessionId: "session-test",
							role: "user",
							content: "Draw a lighthouse",
							createdAt: 1,
						},
					];
				}
				return [];
			},
		);

		await act(async () => current.sendPrompt("Draw a lighthouse"));

		expect(current.status).toBe("completed");
		expect(
			current.messages.findLast((message) => message.role === "assistant"),
		).toMatchObject({
			content: "",
			images: [
				expect.objectContaining({
					data: "aGVsbG8=",
					mediaType: "image/png",
				}),
			],
		});
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

	it("restores a pending question when switching to its session", async () => {
		const hydratedSessionId = "session-with-question";
		const pendingQuestion = {
			requestId: "question-1",
			sessionId: hydratedSessionId,
			createdAt: "2026-08-11T00:00:00.000Z",
			question: "Which branch should I use?",
			options: ["Keep current", "Create new"],
		};
		const askQuestionHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "ask_question_requested",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(askQuestionHandler).toBeTypeOf("function");

		await act(async () => {
			askQuestionHandler?.(pendingQuestion);
		});
		expect(current.pendingAskQuestions).toEqual([]);

		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "poll_ask_questions") {
					return args?.sessionId === hydratedSessionId ? [pendingQuestion] : [];
				}
				if (
					command === "poll_tool_approvals" ||
					command === "read_session_messages" ||
					command === "read_session_hooks"
				) {
					return [];
				}
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "attach") {
						return {
							sessionId: hydratedSessionId,
							status: "running",
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
				status: "running",
				provider: "cline",
				model: "test-model",
				cwd: "/workspace/cline",
				workspaceRoot: "/workspace/cline",
				startedAt: "2026-08-11T00:00:00.000Z",
			});
		});

		await vi.waitFor(() =>
			expect(current.pendingAskQuestions).toEqual([pendingQuestion]),
		);
		expect(invokeMock).toHaveBeenCalledWith("poll_ask_questions", {
			sessionId: hydratedSessionId,
		});
	});

	it("resets to the remembered provider/model after viewing a historical session", async () => {
		window.localStorage.setItem(
			MODEL_SELECTION_STORAGE_KEY,
			JSON.stringify({
				lastProvider: "cline",
				lastModelByProvider: { cline: "remembered-model" },
			}),
		);
		const hydratedSessionId = "session-historical";
		let startConfig: Record<string, unknown> | undefined;
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
							content: "Historical response",
							createdAt: 1,
						},
					];
				}
				if (command === "read_session_hooks") return [];
				if (command === "chat_session_command") {
					const request = args?.request as
						| { action?: string; config?: Record<string, unknown> }
						| undefined;
					if (request?.action === "attach") {
						return {
							sessionId: hydratedSessionId,
							status: "completed",
							provider: "openrouter",
							model: "historical-model",
							cwd: "/workspace/cline",
							workspaceRoot: "/workspace/cline",
						};
					}
					if (request?.action === "start") {
						startConfig = request.config;
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						return {
							ok: true,
							result: { text: "done", finishReason: "completed" },
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
				provider: "openrouter",
				model: "historical-model",
				cwd: "/workspace/cline",
				workspaceRoot: "/workspace/cline",
				startedAt: "2026-07-31T00:00:00.000Z",
			});
		});
		expect(current.config).toMatchObject({
			provider: "openrouter",
			model: "historical-model",
		});

		// Starting a new chat from a hydrated pane resets the session; the
		// composer must return to the remembered defaults instead of retaining
		// the historical session's provider/model.
		await act(async () => {
			await current.reset();
		});
		expect(current.config.sessionId).toBeUndefined();
		expect(current.config).toMatchObject({
			provider: "cline",
			model: "remembered-model",
		});

		// The next session then starts with the remembered defaults.
		await act(async () => current.sendPrompt("Start a fresh task"));
		expect(startConfig).toMatchObject({
			provider: "cline",
			model: "remembered-model",
		});
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

	it("finalizes a queued turn on chat_done: clears the streaming id and reconciles persisted history", async () => {
		// Queued turns resolve their send() RPC early ({ ok: true } without a
		// result), so chat_done is their only finalization signal. Without the
		// turn-end reconcile, a turn whose deltas were incomplete would stay
		// visually streaming forever and only heal when a later non-queued send
		// rehydrated history.
		let canonicalMessages: unknown[] = [];
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					return canonicalMessages;
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
		expect(chatEventHandler).toBeDefined();

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
		// A transport hiccup dropped the tail of the stream: only a truncated
		// prefix of the assistant text arrives live.
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_text",
				chunk: "The answer is",
				ts: Date.now(),
				index: 2,
			});
		});
		canonicalMessages = [
			{
				id: "persisted_user_1",
				sessionId: current.sessionId,
				role: "user",
				content: "First prompt",
				createdAt: Date.now(),
			},
			{
				id: "persisted_assistant_1",
				sessionId: current.sessionId,
				role: "assistant",
				content: "The answer is 42.",
				createdAt: Date.now(),
			},
		];
		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "completed" }),
				ts: Date.now(),
				index: 3,
			});
		});

		// The streaming shimmer clears as soon as the turn settles.
		expect(current.status).toBe("completed");
		expect(current.activeAssistantMessageId).toBeNull();

		// The delayed reconcile replaces the truncated live transcript with the
		// persisted one.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 400));
		});
		const assistantMessages = current.messages.filter(
			(message) => message.role === "assistant",
		);
		expect(assistantMessages).toHaveLength(1);
		expect(assistantMessages[0]?.content).toBe("The answer is 42.");
	});

	it("keeps the live transcript when the turn-end reconcile finds no persisted assistant turn", async () => {
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") {
					// Persistence has not caught up yet.
					return [];
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
		expect(chatEventHandler).toBeDefined();

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
				stream: "chat_text",
				chunk: "Streamed live content",
				ts: Date.now(),
				index: 2,
			});
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_done",
				chunk: JSON.stringify({ reason: "completed" }),
				ts: Date.now(),
				index: 3,
			});
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 400));
		});

		expect(current.status).toBe("completed");
		const assistantMessages = current.messages.filter(
			(message) => message.role === "assistant",
		);
		expect(assistantMessages).toHaveLength(1);
		expect(assistantMessages[0]?.content).toBe("Streamed live content");
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

	it("shows a failure relayed through chat_session_ended", async () => {
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
					if (request?.action === "send") return { ok: true };
				}
				return [];
			},
		);

		await act(async () => current.sendPrompt("Run in cloud"));
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const endedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_session_ended",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: current.sessionId,
				stream: "chat_core_log",
				chunk: JSON.stringify({ level: "error", message: "Cloud run failed" }),
				ts: Date.now(),
				index: 1,
			});
			endedHandler?.({ sessionId: current.sessionId, reason: "error" });
		});

		expect(current.status).toBe("error");
		expect(
			current.messages.find((message) => message.role === "error")?.content,
		).toContain("Cloud run failed");

		await act(async () => {
			endedHandler?.({ sessionId: current.sessionId, reason: "aborted" });
		});
		expect(current.status).toBe("cancelled");
	});

	it("keeps one assistant message when the end event precedes the send reply", async () => {
		let resolveSend!: (value: {
			ok: true;
			result: { text: string; finishReason: "completed" };
		}) => void;
		const sendReply = new Promise<{
			ok: true;
			result: { text: string; finishReason: "completed" };
		}>((resolve) => {
			resolveSend = resolve;
		});
		let markSendStarted!: () => void;
		const sendStarted = new Promise<void>((resolve) => {
			markSendStarted = resolve;
		});
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "read_session_messages") return [];
				if (command === "chat_session_command") {
					const request = args?.request as { action?: string } | undefined;
					if (request?.action === "start") {
						return {
							sessionId: "ses-cloud",
							status: "completed",
							cwd: "/workspace",
							workspaceRoot: "/workspace",
						};
					}
					if (request?.action === "send") {
						markSendStarted();
						return await sendReply;
					}
				}
				return [];
			},
		);

		await act(async () => {
			await current.hydrateSession({
				sessionId: "ses-cloud",
				origin: "cloud",
				repoUrl: "https://github.com/cline/test",
				status: "completed",
				provider: "cline",
				model: "test-model",
				cwd: "/workspace",
				workspaceRoot: "/workspace",
				startedAt: "2026-08-17T00:00:00.000Z",
			});
		});

		let sendPromise!: Promise<void>;
		await act(async () => {
			sendPromise = current.sendPrompt("Answer once");
			await sendStarted;
		});
		const chatEventHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const endedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_session_ended",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			chatEventHandler?.({
				sessionId: "ses-cloud",
				stream: "chat_text",
				chunk: "One response",
				ts: Date.now(),
				index: 1,
			});
			chatEventHandler?.({
				sessionId: "ses-cloud",
				stream: "chat_usage",
				chunk: "{}",
				ts: Date.now(),
				index: 2,
			});
			endedHandler?.({ sessionId: "ses-cloud", reason: "completed" });
			resolveSend({
				ok: true,
				result: { text: "One response", finishReason: "completed" },
			});
			await sendPromise;
		});

		expect(
			current.messages.filter(
				(message) =>
					message.role === "assistant" && message.content === "One response",
			),
		).toHaveLength(1);
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
		expect(current.messages.some((message) => message.role === "error")).toBe(
			true,
		);

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
		expect(current.messages.some((message) => message.role === "error")).toBe(
			true,
		);

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

// A fresh session is still `busy` while its interactive loop starts, so the
// sidecar coerces the first send onto the pending-prompt queue and replies
// {queued:true} with a queue snapshot taken at enqueue time. The turn itself
// runs through the queue drain and completes via stream events
// (chat_queued_prompt_start → deltas → chat_done). When the send RPC response
// arrives only after those events (slow/cold sidecar), its snapshot is stale:
// applying it must not resurrect the queue view or flip the finished turn
// back to "running" (the composer would stay on "Agent is working…" forever).
describe("coerced-queue first turn vs stale send response", () => {
	function getChatEventHandler() {
		return subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_event",
		)?.[1] as ((payload: unknown) => void) | undefined;
	}

	function mockTransport(options?: { deferredSendCount?: number }) {
		const deferredSendCount = options?.deferredSendCount ?? 1;
		const sendResolvers: Array<(value: unknown) => void> = [];
		let sendCalls = 0;
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_process_context") {
					return { cwd: "/workspace/cline", workspaceRoot: "/workspace/cline" };
				}
				if (command === "chat_session_command") {
					const request = args?.request as
						| {
								action?: string;
								sessionId?: string;
								prompt?: string;
								config?: { sessionId?: string };
						  }
						| undefined;
					if (request?.action === "start") {
						return { sessionId: request.config?.sessionId };
					}
					if (request?.action === "send") {
						sendCalls += 1;
						if (sendCalls <= deferredSendCount) {
							return await new Promise((resolve) => {
								sendResolvers.push(resolve);
							});
						}
						return {
							sessionId: request.sessionId,
							ok: true,
							queued: true,
							promptsInQueue: [
								{
									id: `immediate-queued-${sendCalls}`,
									prompt: request.prompt ?? "",
									steer: false,
								},
							],
						};
					}
					if (request?.action === "pending_prompts") {
						return { sessionId: request.sessionId, promptsInQueue: [] };
					}
				}
				return [];
			},
		);
		return sendResolvers;
	}

	// Returns the in-flight sendPrompt promise wrapped in an object: an async
	// function resolving to a bare promise would make callers adopt (await)
	// that promise, deadlocking on the deliberately unresolved send RPC.
	async function dispatchPrompt(prompt: string) {
		let sendPromise: Promise<void> = Promise.resolve();
		await act(async () => {
			sendPromise = current.sendPrompt(prompt);
			// Drain the start/send dispatch chain (startSession RPC, attachment
			// serialization, prompt-dispatch queue) until the send RPC is issued.
			for (let i = 0; i < 5; i += 1) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		});
		return { sendPromise };
	}

	function emitTurnEvents(
		handler: ((payload: unknown) => void) | undefined,
		sid: string | null,
		events: Array<{ stream: string; chunk: string; index: number }>,
	) {
		for (const event of events) {
			handler?.({
				sessionId: sid,
				stream: event.stream,
				chunk: event.chunk,
				ts: Date.now(),
				index: event.index,
			});
		}
	}

	it("ignores a stale queued response that lands after the turn completed", async () => {
		const sendResolvers = mockTransport();
		const { sendPromise } = await dispatchPrompt("Say the word ready");
		expect(sendResolvers).toHaveLength(1);
		const chatEventHandler = getChatEventHandler();
		expect(chatEventHandler).toBeDefined();
		const sid = current.sessionId;
		expect(sid).toBeTruthy();

		// Whole turn completes via stream while the send RPC is in flight.
		await act(async () => {
			emitTurnEvents(chatEventHandler, sid, [
				{
					stream: "chat_queued_prompt_start",
					chunk: JSON.stringify({
						promptId: "queued-prompt-1",
						prompt: "Say the word ready",
						attachmentCount: 0,
					}),
					index: 1,
				},
				{ stream: "chat_text", chunk: "ready", index: 2 },
				{
					stream: "chat_done",
					chunk: JSON.stringify({ reason: "completed" }),
					index: 3,
				},
			]);
		});
		expect(current.status).toBe("completed");

		// The stale response still carries the pre-drain queue snapshot.
		await act(async () => {
			sendResolvers[0]?.({
				sessionId: sid,
				ok: true,
				queued: true,
				promptsInQueue: [
					{
						id: "queued-prompt-1",
						prompt: "Say the word ready",
						steer: false,
					},
				],
			});
			await sendPromise;
		});

		expect(current.status).toBe("completed");
		expect(current.promptsInQueue).toEqual([]);
	});

	it("keeps a mid-stream turn running when the queued response lands late", async () => {
		const sendResolvers = mockTransport();
		const { sendPromise } = await dispatchPrompt("Say the word ready");
		const chatEventHandler = getChatEventHandler();
		const sid = current.sessionId;

		// Turn has started (and is streaming) but not finished.
		await act(async () => {
			emitTurnEvents(chatEventHandler, sid, [
				{
					stream: "chat_queued_prompt_start",
					chunk: JSON.stringify({
						promptId: "queued-prompt-1",
						prompt: "Say the word ready",
						attachmentCount: 0,
					}),
					index: 1,
				},
				{ stream: "chat_text", chunk: "rea", index: 2 },
			]);
		});
		expect(current.status).toBe("running");

		await act(async () => {
			sendResolvers[0]?.({
				sessionId: sid,
				ok: true,
				queued: true,
				promptsInQueue: [
					{
						id: "queued-prompt-1",
						prompt: "Say the word ready",
						steer: false,
					},
				],
			});
			await sendPromise;
		});
		// Still running: the stale snapshot must not resurrect the queue view,
		// and the composer must stay busy while the turn streams.
		expect(current.status).toBe("running");
		expect(current.promptsInQueue).toEqual([]);

		await act(async () => {
			emitTurnEvents(chatEventHandler, sid, [
				{
					stream: "chat_done",
					chunk: JSON.stringify({ reason: "completed" }),
					index: 3,
				},
			]);
		});
		expect(current.status).toBe("completed");
	});

	// Session status events are projected asynchronously from the hub's
	// session record, so a stale "running" can arrive after the stream's
	// chat_done already settled the turn. Applying it would re-wedge the
	// composer on "Agent is working…" with nothing left to reconcile.
	it("ignores stale busy updates arriving after the turn settled", async () => {
		const sendResolvers = mockTransport();
		const { sendPromise } = await dispatchPrompt("Say the word ready");
		const chatEventHandler = getChatEventHandler();
		const statusHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_session_status",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const rehydratedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "cloud_session_rehydrated",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(statusHandler).toBeDefined();
		expect(rehydratedHandler).toBeDefined();
		const sid = current.sessionId;

		await act(async () => {
			emitTurnEvents(chatEventHandler, sid, [
				{
					stream: "chat_queued_prompt_start",
					chunk: JSON.stringify({
						promptId: "queued-prompt-1",
						prompt: "Say the word ready",
						attachmentCount: 0,
					}),
					index: 1,
				},
				{ stream: "chat_text", chunk: "ready", index: 2 },
				{
					stream: "chat_done",
					chunk: JSON.stringify({ reason: "completed" }),
					index: 3,
				},
			]);
		});
		expect(current.status).toBe("completed");
		await act(async () => {
			sendResolvers[0]?.({ sessionId: sid, ok: true, queued: true });
			await sendPromise;
		});

		// Trailing hub-projected status for the turn that already ended.
		await act(async () => {
			statusHandler?.({ sessionId: sid, status: "running" });
		});
		expect(current.status).toBe("completed");
		for (const status of ["running", "pending"]) {
			await act(async () => {
				rehydratedHandler?.({
					sessionId: sid,
					status,
					transcriptKnown: true,
					messages: current.messages,
				});
			});
			expect(current.status).toBe("completed");
		}

		// Non-busy trailing statuses still settle normally.
		await act(async () => {
			statusHandler?.({ sessionId: sid, status: "idle" });
		});
		expect(current.status).toBe("idle");
	});

	it("ignores a stale recovered response after the turn ended", async () => {
		const sendResolvers = mockTransport();
		const { sendPromise } = await dispatchPrompt("Finish during reconnect");
		const endedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_session_ended",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const sid = current.sessionId;

		await act(async () => {
			endedHandler?.({ sessionId: sid, reason: "completed" });
		});
		expect(current.status).toBe("completed");

		await act(async () => {
			sendResolvers[0]?.({
				sessionId: sid,
				ok: true,
				recoveredAfterDisconnect: true,
				status: "running",
			});
			await sendPromise;
		});
		expect(current.status).toBe("completed");
	});

	it("still applies 'running' status events once a new turn has started", async () => {
		const sendResolvers = mockTransport();
		const { sendPromise } = await dispatchPrompt("Say the word ready");
		const chatEventHandler = getChatEventHandler();
		const statusHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "chat_session_status",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const sid = current.sessionId;

		// Turn 1 completes.
		await act(async () => {
			emitTurnEvents(chatEventHandler, sid, [
				{
					stream: "chat_queued_prompt_start",
					chunk: JSON.stringify({
						promptId: "queued-prompt-1",
						prompt: "Say the word ready",
						attachmentCount: 0,
					}),
					index: 1,
				},
				{
					stream: "chat_done",
					chunk: JSON.stringify({ reason: "completed" }),
					index: 2,
				},
			]);
		});
		await act(async () => {
			sendResolvers[0]?.({ sessionId: sid, ok: true, queued: true });
			await sendPromise;
		});
		expect(current.status).toBe("completed");

		// Turn 2 starts via the stream (epoch bump): running status events
		// belong to the live turn again and must apply.
		await act(async () => {
			emitTurnEvents(chatEventHandler, sid, [
				{
					stream: "chat_queued_prompt_start",
					chunk: JSON.stringify({
						promptId: "queued-prompt-2",
						prompt: "again",
						attachmentCount: 0,
					}),
					index: 3,
				},
			]);
		});
		expect(current.status).toBe("running");
		await act(async () => {
			statusHandler?.({ sessionId: sid, status: "running" });
		});
		expect(current.status).toBe("running");

		await act(async () => {
			emitTurnEvents(chatEventHandler, sid, [
				{
					stream: "chat_done",
					chunk: JSON.stringify({ reason: "completed" }),
					index: 4,
				},
			]);
		});
		expect(current.status).toBe("completed");
	});

	it("keeps a local submission authoritative over a stale terminal rehydration", async () => {
		const sendResolvers = mockTransport();
		const { sendPromise } = await dispatchPrompt("Continue working");
		const rehydratedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "cloud_session_rehydrated",
		)?.[1] as ((payload: unknown) => void) | undefined;
		const sid = current.sessionId;
		expect(rehydratedHandler).toBeDefined();
		expect(current.status).toBe("starting");

		await act(async () => {
			rehydratedHandler?.({
				sessionId: sid,
				status: "completed",
				transcriptKnown: true,
				messages: [],
			});
		});

		expect(current.status).toBe("starting");
		expect(
			current.messages.some(
				(message) =>
					message.role === "user" && message.content === "Continue working",
			),
		).toBe(true);

		await act(async () => {
			sendResolvers[0]?.({ sessionId: sid, ok: true, queued: true });
			await sendPromise;
		});
		await act(async () => {
			rehydratedHandler?.({
				sessionId: sid,
				status: "completed",
				transcriptKnown: true,
				messages: [],
			});
		});

		expect(current.status).toBe("running");
		expect(
			current.messages.some(
				(message) =>
					message.role === "user" && message.content === "Continue working",
			),
		).toBe(true);
	});

	it("ignores a rehydration read that resolves after a new turn starts", async () => {
		mockTransport({ deferredSendCount: 0 });
		const transport = invokeMock.getMockImplementation();
		let resolveRead!: (messages: unknown[]) => void;
		const read = new Promise<unknown[]>((resolve) => {
			resolveRead = resolve;
		});
		invokeMock.mockImplementation(async (command, args) => {
			if (command === "read_session_messages") return await read;
			return await transport?.(command, args);
		});
		const { sendPromise } = await dispatchPrompt("first prompt");
		await act(async () => sendPromise);
		const sid = current.sessionId;
		const chatEventHandler = getChatEventHandler();
		const rehydratedHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "cloud_session_rehydrated",
		)?.[1] as ((payload: unknown) => void) | undefined;

		await act(async () => {
			rehydratedHandler?.({ sessionId: sid, status: "completed" });
		});
		await act(async () => {
			emitTurnEvents(chatEventHandler, sid, [
				{
					stream: "chat_queued_prompt_start",
					chunk: JSON.stringify({ prompt: "first prompt" }),
					index: 1,
				},
			]);
			resolveRead([]);
			await read;
		});

		expect(current.status).toBe("running");
	});

	it("still applies a queued response for a deliberately queued prompt", async () => {
		// First send stays in flight (turn 1 running); the second prompt is
		// deliberately queued behind it and its response must keep updating
		// the queue view exactly as before.
		const sendResolvers = mockTransport({ deferredSendCount: 1 });
		await dispatchPrompt("first prompt");
		const chatEventHandler = getChatEventHandler();
		const sid = current.sessionId;

		await act(async () => {
			emitTurnEvents(chatEventHandler, sid, [
				{
					stream: "chat_queued_prompt_start",
					chunk: JSON.stringify({
						promptId: "queued-prompt-1",
						prompt: "first prompt",
						attachmentCount: 0,
					}),
					index: 1,
				},
				{ stream: "chat_text", chunk: "working…", index: 2 },
			]);
		});
		expect(current.status).toBe("running");
		expect(sendResolvers).toHaveLength(1);

		// Second prompt: queued deliberately while turn 1 streams; its send
		// RPC resolves immediately with the server queue snapshot.
		await dispatchPrompt("second prompt");

		expect(current.status).toBe("running");
		expect(current.promptsInQueue).toHaveLength(1);
		expect(current.promptsInQueue[0]?.prompt).toBe("second prompt");
	});
});
