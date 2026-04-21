import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClineCoreStartInput } from "./ClineCore";
import type {
	StartSessionInput,
	StartSessionResult,
} from "./runtime/runtime-host";

const { createRuntimeHostMock } = vi.hoisted(() => ({
	createRuntimeHostMock: vi.fn(),
}));

vi.mock("./runtime/host", () => ({
	createRuntimeHost: createRuntimeHostMock,
}));

import { ClineCore } from "./ClineCore";

function createStartInput(): ClineCoreStartInput {
	return {
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "test",
			cwd: "/tmp/workspace",
			workspaceRoot: "/tmp/workspace",
			systemPrompt: "You are concise.",
			mode: "act",
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
		messagesPath: `/tmp/${sessionId}.messages.json`,
	};
}

describe("ClineCore", () => {
	beforeEach(() => {
		createRuntimeHostMock.mockReset();
	});

	it("applies start-session bootstraps before delegating to the host", async () => {
		const listeners: Array<
			(event: { type: string; payload: { sessionId: string } }) => void
		> = [];
		const host = {
			runtimeAddress: undefined,
			start: vi.fn(async (input: StartSessionInput) => {
				expect(input.config.systemPrompt).toBe("Bootstrapped prompt");
				expect(input.localRuntime?.configOverrides?.extensions).toEqual([
					expect.objectContaining({ name: "enterprise" }),
				]);
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
			subscribe: vi.fn((listener) => {
				listeners.push(listener);
				return () => {};
			}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const dispose = vi.fn(async () => {});
		const applyToStartSessionInput = vi.fn(
			async (input: ClineCoreStartInput) => ({
				...input,
				config: {
					...input.config,
					systemPrompt: "Bootstrapped prompt",
					extensions: [
						{
							name: "enterprise",
							manifest: { capabilities: [] },
							setup: vi.fn(),
						},
					],
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
			subscribe: vi.fn((nextListener) => {
				listener = nextListener;
				return () => {};
			}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

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

	it("hydrates list rows through the core API", async () => {
		const host = {
			runtimeAddress: undefined,
			start: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stop: vi.fn(),
			dispose: vi.fn(),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => [
				{
					sessionId: "session-3",
					source: "cli",
					pid: 1,
					startedAt: "2026-04-21T02:17:46.169Z",
					status: "completed",
					interactive: false,
					provider: "",
					model: "",
					cwd: "/tmp/workspace",
					workspaceRoot: "/tmp/workspace",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					prompt: "hello",
					metadata: {},
					updatedAt: "2026-04-21T02:17:46.169Z",
				},
			]),
			delete: vi.fn(),
			update: vi.fn(),
			readMessages: vi.fn(async () => [
				{
					role: "user",
					content: [{ type: "text", text: "hello" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "hi" }],
					modelInfo: {
						provider: "cline",
						id: "anthropic/claude-sonnet-4.6",
					},
					metrics: {
						cost: 0.02,
					},
				},
			]),
			handleHookEvent: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const core = await ClineCore.create();
		const [row] = await core.list(10);

		expect(host.list).toHaveBeenCalledWith(10);
		expect(host.readMessages).toHaveBeenCalledWith("session-3");
		expect(row).toMatchObject({
			sessionId: "session-3",
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			metadata: {
				title: "hello",
				totalCost: 0.02,
			},
		});
	});
});
