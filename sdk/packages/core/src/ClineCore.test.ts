import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	StartSessionInput,
	StartSessionResult,
} from "./session/session-manager";

const { createSessionHostMock } = vi.hoisted(() => ({
	createSessionHostMock: vi.fn(),
}));

vi.mock("./session/session-host", () => ({
	createSessionHost: createSessionHostMock,
}));

import { ClineCore } from "./ClineCore";

function createStartInput(): StartSessionInput {
	return {
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "test",
			cwd: "/tmp/workspace",
			workspaceRoot: "/tmp/workspace",
			systemPrompt: "You are concise.",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
		prompt: "hello",
		interactive: false,
	};
}

function createStartResult(sessionId: string): StartSessionResult {
	return {
		sessionId,
		manifest: {} as StartSessionResult["manifest"],
		manifestPath: `/tmp/${sessionId}.json`,
		transcriptPath: `/tmp/${sessionId}.log`,
		hookPath: `/tmp/${sessionId}.hooks.jsonl`,
		messagesPath: `/tmp/${sessionId}.messages.json`,
	};
}

describe("ClineCore", () => {
	beforeEach(() => {
		createSessionHostMock.mockReset();
	});

	it("applies start-session bootstraps before delegating to the host", async () => {
		const listeners: Array<
			(event: { type: string; payload: { sessionId: string } }) => void
		> = [];
		const host = {
			runtimeAddress: undefined,
			start: vi.fn(async (input: StartSessionInput) => {
				expect(input.config.systemPrompt).toBe("Bootstrapped prompt");
				expect(input.config.extensions).toEqual([{ name: "enterprise" }]);
				return createStartResult("session-1");
			}),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stop: vi.fn(),
			dispose: vi.fn(),
			get: vi.fn(async () => undefined),
			list: vi.fn(),
			delete: vi.fn(),
			readMessages: vi.fn(),
			readTranscript: vi.fn(),
			readHooks: vi.fn(),
			subscribe: vi.fn((listener) => {
				listeners.push(listener);
				return () => {};
			}),
			updateSessionModel: vi.fn(),
		};
		createSessionHostMock.mockResolvedValue(host);

		const dispose = vi.fn(async () => {});
		const applyToStartSessionInput = vi.fn(
			async (input: StartSessionInput) => ({
				...input,
				config: {
					...input.config,
					systemPrompt: "Bootstrapped prompt",
					extensions: [
						{ name: "enterprise" },
					] as StartSessionInput["config"]["extensions"],
				},
			}),
		);

		const core = await ClineCore.create({
			prepare: async () => ({
				applyToStartSessionInput,
				dispose,
			}),
		});

		await core.start(createStartInput());

		expect(applyToStartSessionInput).toHaveBeenCalledTimes(1);
		expect(host.start).toHaveBeenCalledTimes(1);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(listeners).toHaveLength(1);
	});

	it("disposes active session bootstraps when the session ends", async () => {
		let listener:
			| ((event: { type: string; payload: { sessionId: string } }) => void)
			| undefined;
		const host = {
			runtimeAddress: "127.0.0.1:5317",
			start: vi.fn(async () => createStartResult("session-2")),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stop: vi.fn(),
			dispose: vi.fn(),
			get: vi.fn(async () => ({ sessionId: "session-2" })),
			list: vi.fn(),
			delete: vi.fn(),
			readMessages: vi.fn(),
			readTranscript: vi.fn(),
			readHooks: vi.fn(),
			subscribe: vi.fn((nextListener) => {
				listener = nextListener;
				return () => {};
			}),
			updateSessionModel: vi.fn(),
		};
		createSessionHostMock.mockResolvedValue(host);

		const dispose = vi.fn(async () => {});
		const core = await ClineCore.create({
			prepare: async () => ({
				applyToStartSessionInput: (input) => input,
				dispose,
			}),
		});
		expect(core.runtimeAddress).toBe("127.0.0.1:5317");

		await core.start(createStartInput());
		expect(dispose).not.toHaveBeenCalled();

		listener?.({ type: "ended", payload: { sessionId: "session-2" } });
		await Promise.resolve();

		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
