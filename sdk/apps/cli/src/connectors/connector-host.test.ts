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
	const posts: string[] = [];
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
			async post(message: string) {
				posts.push(message);
				const sentMessage = {
					edit: async (nextMessage: string) => {
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

		const baseStartRequest = {
			enableTools: false,
			autoApproveTools: false,
			cwd: "/tmp/work",
			workspaceRoot: "/tmp/work",
			systemPrompt: "system",
			provider: "cline",
			model: "test-model",
			mode: "act",
		};

		const commonInput = {
			thread: thread as never,
			client: {} as never,
			pendingApprovals: new Map(),
			baseStartRequest: baseStartRequest as never,
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

		expect(posts[0]).toBe("Connected.\nWelcome.");
		expect(
			posts.filter((message) => message === "Connected.\nWelcome."),
		).toHaveLength(1);
		expect(posts.at(-1)).toContain("participantKey=telegram:user:alice");
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
			baseStartRequest: {
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp/work",
				workspaceRoot: "/tmp/work",
				systemPrompt: "system",
				provider: "cline",
				model: "test-model",
				mode: "act",
			} as never,
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
});
