// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./use-chat-session";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		getTransportError: vi.fn(() => null),
		getTransportState: vi.fn(() => "connected"),
		invoke: invokeMock,
		subscribe: vi.fn(() => () => undefined),
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
			current.setConfig((previous) => ({
				...previous,
				workspaceRoot: "/workspace/selected",
				cwd: "/workspace/selected",
			}));
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
});
