import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SentMessage } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleConnectorUserTurn } from "./connector-host";

vi.mock("./hooks", () => ({
	authorizeConnectorEvent: vi.fn(async () => ({ action: "allow" })),
	dispatchConnectorHook: vi.fn(async () => undefined),
}));

// Get references to the mocked functions after the mock is set up
import { authorizeConnectorEvent, dispatchConnectorHook } from "./hooks";

const authorizeConnectorEventMock = vi.mocked(authorizeConnectorEvent);
const dispatchConnectorHookMock = vi.mocked(dispatchConnectorHook);

type TestState = {
	sessionId?: string;
	enableTools?: boolean;
	autoApproveTools?: boolean;
	cwd?: string;
	workspaceRoot?: string;
	systemPrompt?: string;
	participantKey?: string;
	participantLabel?: string;
	welcomeSentAt?: string;
};

function createThread(initialState: TestState = {}) {
	let state = { ...initialState };
	const posts: unknown[] = [];
	return {
		thread: {
			id: "thread-1",
			channelId: "channel-1",
			isDM: true,
			get state() {
				return Promise.resolve(state);
			},
			async setState(nextState: TestState) {
				state = { ...nextState };
			},
			async post(message: unknown) {
				posts.push(message);
				const sentMessage = {
					edit: async (nextMessage: unknown) => {
						posts.push(nextMessage);
						return sentMessage as unknown as SentMessage;
					},
					delete: async () => undefined,
				};
				return sentMessage as unknown as SentMessage;
			},
			async startTyping() {},
			toJSON() {
				return {
					id: "thread-1",
					channelId: "channel-1",
					isDM: true,
					state,
				};
			},
		},
		posts,
		getState: () => state,
	};
}

function baseStartRequest(overrides: Partial<TestState> = {}) {
	return {
		enableTools: overrides.enableTools ?? false,
		autoApproveTools: overrides.autoApproveTools ?? false,
		cwd: overrides.cwd ?? "/tmp/work",
		workspaceRoot: overrides.workspaceRoot ?? "/tmp/work",
		systemPrompt: overrides.systemPrompt ?? "system",
		provider: "cline",
		model: "test-model",
		mode: "act",
	};
}

function createRuntimeClient(responseText: string) {
	const startRuntimeSession = vi.fn(async () => ({ sessionId: "session-1" }));
	const updateSession = vi.fn(async () => undefined);
	const sendRuntimeSession = vi.fn(async () => ({
		result: {
			text: responseText,
			finishReason: "stop",
			iterations: 1,
		},
	}));
	return {
		client: {
			startRuntimeSession,
			updateSession,
			sendRuntimeSession,
			streamEvents: vi.fn(() => () => undefined),
		},
		startRuntimeSession,
		updateSession,
		sendRuntimeSession,
	};
}

function messageText(message: unknown): string {
	if (typeof message === "string") {
		return message;
	}
	if (message && typeof message === "object" && "raw" in message) {
		const raw = (message as { raw: unknown }).raw;
		return typeof raw === "string" ? raw : String(raw);
	}
	return String(message);
}

describe("handleConnectorUserTurn", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		authorizeConnectorEventMock.mockReset();
		authorizeConnectorEventMock.mockResolvedValue({ action: "allow" });
		dispatchConnectorHookMock.mockReset();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("sends a first-contact message only once per persisted thread state", async () => {
		const dir = mkdtempSync(join(tmpdir(), "connector-host-test-"));
		tempDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, posts, getState } = createThread({
			enableTools: false,
			autoApproveTools: false,
			cwd: "/tmp/work",
			workspaceRoot: "/tmp/work",
			participantKey: "telegram:user:alice",
			participantLabel: "alice",
		});

		const commonInput = {
			thread: thread as never,
			client: {} as never,
			pendingApprovals: new Map(),
			baseStartRequest: baseStartRequest() as never,
			explicitSystemPrompt: undefined,
			clientId: "client-1",
			logger: {
				core: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
			} as never,
			transport: "telegram",
			botUserName: "ClineAdapterBot",
			requestStop: vi.fn(),
			bindingsPath,
			systemRules: "rules",
			errorLabel: "Telegram",
			firstContactMessage: "Connected.\nWelcome.",
			getSessionMetadata: () => ({}),
			reusedLogMessage: "reused",
		};

		await handleConnectorUserTurn({
			...commonInput,
			text: "/whereami",
		});

		await handleConnectorUserTurn({
			...commonInput,
			text: "/whereami",
		});

		expect(posts[0]).toEqual({ raw: "Connected.\nWelcome." });
		expect(
			posts.filter(
				(message) => messageText(message) === "Connected.\nWelcome.",
			),
		).toHaveLength(1);
		expect(messageText(posts.at(-1))).toContain(
			"participantKey=telegram:user:alice",
		);
		expect(getState().welcomeSentAt).toBeTruthy();
	});

	it("blocks unauthorized inbound messages through the shared authorization hook", async () => {
		authorizeConnectorEventMock.mockResolvedValue({
			action: "deny",
			message: "Access denied.",
			reason: "not_on_allowlist",
		});
		const dir = mkdtempSync(join(tmpdir(), "connector-host-test-"));
		tempDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, posts, getState } = createThread({
			enableTools: false,
			autoApproveTools: false,
			cwd: "/tmp/work",
			workspaceRoot: "/tmp/work",
			participantKey: "slack:team:T123:user:U123",
			participantLabel: "alice",
		});

		await handleConnectorUserTurn({
			thread: thread as never,
			text: "hello",
			client: {} as never,
			pendingApprovals: new Map(),
			baseStartRequest: baseStartRequest() as never,
			explicitSystemPrompt: undefined,
			clientId: "client-1",
			logger: {
				core: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
			} as never,
			transport: "slack",
			botUserName: "ClineAdapterBot",
			requestStop: vi.fn(),
			bindingsPath,
			hookCommand: "echo noop",
			systemRules: "rules",
			errorLabel: "Slack",
			firstContactMessage: "Connected.\nWelcome.",
			getSessionMetadata: () => ({}),
			reusedLogMessage: "reused",
		});

		expect(posts).toEqual(["Access denied."]);
		expect(dispatchConnectorHookMock).toHaveBeenCalledWith(
			"echo noop",
			expect.objectContaining({
				event: "message.denied",
				payload: expect.objectContaining({
					participantKey: "slack:team:T123:user:U123",
					reason: "not_on_allowlist",
				}),
			}),
			expect.anything(),
		);
		expect(getState().welcomeSentAt).toBeUndefined();
	});

	it("keeps tools disabled when connector startup forced no-tools", async () => {
		const dir = mkdtempSync(join(tmpdir(), "connector-host-test-"));
		tempDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, posts } = createThread({
			enableTools: true,
			autoApproveTools: true,
			cwd: "/tmp/work",
			workspaceRoot: "/tmp/work",
		});

		const commonInput = {
			thread: thread as never,
			client: {} as never,
			pendingApprovals: new Map(),
			baseStartRequest: baseStartRequest({
				enableTools: false,
				autoApproveTools: false,
			}) as never,
			explicitSystemPrompt: undefined,
			clientId: "client-1",
			logger: {
				core: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
			} as never,
			transport: "telegram",
			botUserName: "ClineAdapterBot",
			requestStop: vi.fn(),
			bindingsPath,
			systemRules: "rules",
			errorLabel: "Telegram",
			getSessionMetadata: () => ({}),
			reusedLogMessage: "reused",
			forceDisableTools: true,
		};

		await handleConnectorUserTurn({
			...commonInput,
			text: "/whereami",
		});

		expect(messageText(posts.at(-1))).toContain("tools=off");
		expect(messageText(posts.at(-1))).toContain("yolo=off");

		await handleConnectorUserTurn({
			...commonInput,
			text: "/tools on",
		});

		expect(posts.at(-1)).toEqual({
			raw: "tools=off (disabled by connector startup)",
		});

		await handleConnectorUserTurn({
			...commonInput,
			text: "/tools@ClineAdapterBot on",
		});

		expect(posts.at(-1)).toEqual({
			raw: "tools=off (disabled by connector startup)",
		});

		const runtime = createRuntimeClient("not a local tools command");
		await handleConnectorUserTurn({
			...commonInput,
			text: "/tools@OtherBot on",
			client: runtime.client as never,
			startedLogMessage: "started",
		});

		expect(posts.at(-1)).toEqual({ raw: "not a local tools command" });
		expect(runtime.sendRuntimeSession).toHaveBeenCalledWith(
			"session-1",
			expect.objectContaining({
				prompt: expect.stringContaining("/tools@OtherBot on"),
				config: expect.objectContaining({
					enableTools: false,
					autoApproveTools: false,
				}),
			}),
			{ timeoutMs: null },
		);

		await handleConnectorUserTurn({
			...commonInput,
			text: "/yolo@ClineAdapterBot on",
		});

		expect(posts.at(-1)).toEqual({
			raw: "yolo=off (disabled by connector startup)",
		});
	});

	it("creates schedules with forced-disabled runtime options", async () => {
		const dir = mkdtempSync(join(tmpdir(), "connector-host-test-"));
		tempDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, posts } = createThread({
			enableTools: true,
			autoApproveTools: true,
			cwd: "/tmp/work",
			workspaceRoot: "/tmp/work",
			participantKey: "telegram:user:alice",
			participantLabel: "alice",
		});
		const createSchedule = vi.fn(async () => ({
			name: "nightly",
			scheduleId: "schedule-1",
			cronPattern: "0 * * * *",
			nextRunAt: "2026-05-01T20:00:00.000Z",
		}));

		await handleConnectorUserTurn({
			thread: thread as never,
			text: '/schedule create "nightly" --cron "0 * * * *" --prompt "check repo"',
			client: { createSchedule } as never,
			pendingApprovals: new Map(),
			baseStartRequest: baseStartRequest({
				enableTools: false,
				autoApproveTools: false,
			}) as never,
			explicitSystemPrompt: undefined,
			clientId: "client-1",
			logger: {
				core: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
			} as never,
			transport: "telegram",
			botUserName: "ClineAdapterBot",
			requestStop: vi.fn(),
			bindingsPath,
			systemRules: "rules",
			errorLabel: "Telegram",
			getSessionMetadata: () => ({}),
			reusedLogMessage: "reused",
			forceDisableTools: true,
		});

		expect(createSchedule).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "nightly",
				cronPattern: "0 * * * *",
				prompt: "check repo",
				runtimeOptions: {
					enableTools: false,
					enableSpawn: false,
					enableTeams: false,
					autoApproveTools: false,
				},
				metadata: expect.objectContaining({
					delivery: expect.objectContaining({
						adapter: "telegram",
						bindingKey: "telegram:user:alice",
					}),
				}),
			}),
		);
		expect(messageText(posts.at(-1))).toContain('Scheduled "nightly".');
	});

	it("handles schedule commands directly in connector chats", async () => {
		const dir = mkdtempSync(join(tmpdir(), "connector-host-test-"));
		tempDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, posts } = createThread({
			cwd: "/tmp/work",
			workspaceRoot: "/tmp/work",
			participantKey: "telegram:user:alice",
			participantLabel: "alice",
		});
		const createSchedule = vi.fn(async () => ({
			name: "nightly",
			scheduleId: "schedule-1",
			cronPattern: "0 * * * *",
			nextRunAt: "2026-05-01T20:00:00.000Z",
		}));
		const listSchedules = vi.fn(async () => [
			{
				name: "nightly",
				scheduleId: "schedule-1",
				cronPattern: "0 * * * *",
				nextRunAt: "2026-05-01T20:00:00.000Z",
				enabled: true,
				metadata: {
					delivery: {
						adapter: "telegram",
						bindingKey: "telegram:user:alice",
						threadId: "thread-1",
					},
				},
			},
			{
				name: "other",
				scheduleId: "schedule-2",
				cronPattern: "0 9 * * *",
				enabled: true,
				metadata: {
					delivery: {
						adapter: "telegram",
						bindingKey: "telegram:user:bob",
						threadId: "thread-2",
					},
				},
			},
		]);
		const triggerScheduleNow = vi.fn(async () => ({
			executionId: "execution-1",
			status: "queued",
		}));
		const deleteSchedule = vi.fn(async () => true);
		const commonInput = {
			thread: thread as never,
			client: {
				createSchedule,
				listSchedules,
				triggerScheduleNow,
				deleteSchedule,
			} as never,
			pendingApprovals: new Map(),
			baseStartRequest: baseStartRequest() as never,
			explicitSystemPrompt: undefined,
			clientId: "client-1",
			logger: {
				core: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
			} as never,
			transport: "telegram",
			botUserName: "ClineAdapterBot",
			requestStop: vi.fn(),
			bindingsPath,
			systemRules: "rules",
			errorLabel: "Telegram",
			getSessionMetadata: () => ({}),
			reusedLogMessage: "reused",
		};

		await handleConnectorUserTurn({
			...commonInput,
			text: '/schedule create "nightly" --cron "0 * * * *" --prompt "check repo"',
		});
		await handleConnectorUserTurn({ ...commonInput, text: "/schedule list" });
		await handleConnectorUserTurn({
			...commonInput,
			text: "/schedule trigger schedule-1",
		});
		await handleConnectorUserTurn({
			...commonInput,
			text: "/schedule delete schedule-1",
		});

		expect(createSchedule).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "nightly",
				cronPattern: "0 * * * *",
				prompt: "check repo",
				metadata: expect.objectContaining({
					delivery: expect.objectContaining({
						adapter: "telegram",
						threadId: "thread-1",
						bindingKey: "telegram:user:alice",
						userName: "ClineAdapterBot",
					}),
				}),
			}),
		);
		expect(messageText(posts.at(-4))).toContain('Scheduled "nightly".');
		expect(messageText(posts.at(-3))).toContain("schedule-1 [enabled]");
		expect(messageText(posts.at(-3))).not.toContain("schedule-2");
		expect(messageText(posts.at(-2))).toContain(
			"Triggered schedule schedule-1.",
		);
		expect(triggerScheduleNow).toHaveBeenCalledWith("schedule-1");
		expect(messageText(posts.at(-1))).toBe("Deleted schedule schedule-1.");
		expect(deleteSchedule).toHaveBeenCalledWith("schedule-1");
	});

	it("posts Telegram runtime replies as raw text and disables tools in runtime config", async () => {
		const dir = mkdtempSync(join(tmpdir(), "connector-host-test-"));
		tempDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, posts } = createThread({
			enableTools: true,
			autoApproveTools: true,
			cwd: "/tmp/work",
			workspaceRoot: "/tmp/work",
		});
		const runtime = createRuntimeClient(
			"Here is dangling markdown: **repo `sdk",
		);

		await handleConnectorUserTurn({
			thread: thread as never,
			text: "hello",
			client: runtime.client as never,
			pendingApprovals: new Map(),
			baseStartRequest: baseStartRequest({
				enableTools: false,
				autoApproveTools: false,
			}) as never,
			explicitSystemPrompt: undefined,
			clientId: "client-1",
			logger: {
				core: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
			} as never,
			transport: "telegram",
			botUserName: "ClineAdapterBot",
			requestStop: vi.fn(),
			bindingsPath,
			systemRules: "rules",
			errorLabel: "Telegram",
			getSessionMetadata: () => ({}),
			reusedLogMessage: "reused",
			startedLogMessage: "started",
			forceDisableTools: true,
		});

		expect(runtime.startRuntimeSession).toHaveBeenCalledWith(
			expect.objectContaining({
				enableTools: false,
				enableSpawn: false,
				enableTeams: false,
				autoApproveTools: false,
			}),
		);
		expect(runtime.sendRuntimeSession).toHaveBeenCalledWith(
			"session-1",
			expect.objectContaining({
				config: expect.objectContaining({
					enableTools: false,
					enableSpawn: false,
					enableTeams: false,
					autoApproveTools: false,
				}),
			}),
			{ timeoutMs: null },
		);
		expect(posts.at(-1)).toEqual({
			raw: "Here is dangling markdown: **repo `sdk",
		});
	});

	it("lets Telegram adapters override final runtime reply delivery", async () => {
		const dir = mkdtempSync(join(tmpdir(), "connector-host-test-"));
		tempDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, posts } = createThread({
			enableTools: true,
			autoApproveTools: true,
			cwd: "/tmp/work",
			workspaceRoot: "/tmp/work",
		});
		const runtime = createRuntimeClient("**Formatted** reply");
		const postFinalReply = vi.fn(async () => undefined);

		await handleConnectorUserTurn({
			thread: thread as never,
			text: "hello",
			client: runtime.client as never,
			pendingApprovals: new Map(),
			baseStartRequest: baseStartRequest() as never,
			explicitSystemPrompt: undefined,
			clientId: "client-1",
			logger: {
				core: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
			} as never,
			transport: "telegram",
			botUserName: "ClineAdapterBot",
			requestStop: vi.fn(),
			bindingsPath,
			systemRules: "rules",
			errorLabel: "Telegram",
			getSessionMetadata: () => ({}),
			reusedLogMessage: "reused",
			startedLogMessage: "started",
			postFinalReply,
		});

		expect(postFinalReply).toHaveBeenCalledWith({
			thread,
			text: "**Formatted** reply",
		});
		expect(posts).not.toContainEqual({ raw: "**Formatted** reply" });
	});

	it("steers active Telegram turns without the hub command timeout", async () => {
		const dir = mkdtempSync(join(tmpdir(), "connector-host-test-"));
		tempDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, posts } = createThread({
			enableTools: true,
			autoApproveTools: true,
			cwd: "/tmp/work",
			workspaceRoot: "/tmp/work",
			welcomeSentAt: new Date().toISOString(),
		});
		const runtime = createRuntimeClient("unused");
		const activeTurns = new Map([["thread-1", { sessionId: "session-1" }]]);

		await handleConnectorUserTurn({
			thread: thread as never,
			text: "add this detail while you are working",
			client: runtime.client as never,
			pendingApprovals: new Map(),
			baseStartRequest: baseStartRequest() as never,
			explicitSystemPrompt: undefined,
			clientId: "client-1",
			logger: {
				core: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
			} as never,
			transport: "telegram",
			botUserName: "ClineAdapterBot",
			requestStop: vi.fn(),
			bindingsPath,
			systemRules: "rules",
			errorLabel: "Telegram",
			getSessionMetadata: () => ({}),
			reusedLogMessage: "reused",
			activeTurns,
		});

		expect(runtime.startRuntimeSession).not.toHaveBeenCalled();
		expect(runtime.sendRuntimeSession).toHaveBeenCalledWith(
			"session-1",
			expect.objectContaining({
				delivery: "steer",
			}),
			{ timeoutMs: null },
		);
		expect(posts.at(-1)).toEqual({ raw: "Steering current task." });
	});
});
