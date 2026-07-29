import type { AgentConfig, AgentResult } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { AgentTeamsRuntime, type TeamRunAdmissionError } from "./multi-agent";

const { createSessionRuntimeMock } = vi.hoisted(() => ({
	// biome-ignore lint/complexity/useArrowFunction: production calls this with `new`.
	createSessionRuntimeMock: vi.fn(function (_config?: unknown) {}),
}));

vi.mock("../../../runtime/orchestration/session-runtime-orchestrator", () => ({
	SessionRuntime: createSessionRuntimeMock,
}));

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function result(text = "done"): AgentResult {
	return {
		text,
		iterations: 1,
		finishReason: "completed",
		durationMs: 1,
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		model: { id: "test-model", provider: "test-provider" },
		startedAt: new Date(0),
		endedAt: new Date(1),
	};
}

function runtimeMock(run: () => Promise<AgentResult>) {
	return {
		abort: vi.fn(),
		run: vi.fn(run),
		continue: vi.fn(run),
		canStartRun: vi.fn(() => true),
		getAgentId: vi.fn(() => "runtime-agent"),
		getConversationId: vi.fn(() => "conversation"),
		getMessages: vi.fn(() => []),
		subscribeEvents: vi.fn(() => () => {}),
	};
}

const teammateConfig: AgentConfig = {
	providerId: "anthropic",
	modelId: "test-model",
	systemPrompt: "help",
	tools: [],
};

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("AgentTeamsRuntime scheduler", () => {
	it("serializes runs for one teammate", async () => {
		const first = deferred<AgentResult>();
		const second = deferred<AgentResult>();
		const agent = runtimeMock(
			vi
				.fn()
				.mockImplementationOnce(() => first.promise)
				.mockImplementationOnce(() => second.promise),
		);
		// biome-ignore lint/complexity/useArrowFunction: production constructs SessionRuntime with `new`.
		createSessionRuntimeMock.mockImplementationOnce(function () {
			return agent;
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "team",
			maxConcurrentRuns: 2,
		});
		runtime.spawnTeammate({ agentId: "alice", config: teammateConfig });

		const run1 = runtime.startTeammateRun("alice", "first");
		const run2 = runtime.startTeammateRun("alice", "second");
		expect(agent.run).toHaveBeenCalledTimes(1);
		expect(runtime.getRun(run2.id)?.status).toBe("queued");

		first.resolve(result("first"));
		await flush();
		expect(agent.run).toHaveBeenCalledTimes(2);
		expect(runtime.getRun(run1.id)?.status).toBe("completed");
		second.resolve(result("second"));
		await flush();
		expect(runtime.getRun(run2.id)?.status).toBe("completed");
	});

	it("runs independent teammates in parallel", () => {
		const aliceRun = deferred<AgentResult>();
		const bobRun = deferred<AgentResult>();
		const alice = runtimeMock(() => aliceRun.promise);
		const bob = runtimeMock(() => bobRun.promise);
		createSessionRuntimeMock
			// biome-ignore lint/complexity/useArrowFunction: production constructs SessionRuntime with `new`.
			.mockImplementationOnce(function () {
				return alice;
			})
			// biome-ignore lint/complexity/useArrowFunction: production constructs SessionRuntime with `new`.
			.mockImplementationOnce(function () {
				return bob;
			});
		const runtime = new AgentTeamsRuntime({
			teamName: "team",
			maxConcurrentRuns: 2,
		});
		runtime.spawnTeammate({ agentId: "alice", config: teammateConfig });
		runtime.spawnTeammate({ agentId: "bob", config: teammateConfig });

		const run1 = runtime.startTeammateRun("alice", "first");
		const run2 = runtime.startTeammateRun("bob", "second");
		expect(alice.run).toHaveBeenCalledTimes(1);
		expect(bob.run).toHaveBeenCalledTimes(1);
		expect(runtime.getRun(run1.id)?.status).toBe("running");
		expect(runtime.getRun(run2.id)?.status).toBe("running");
	});

	it("enforces queued-count and message-byte admission", () => {
		const active = deferred<AgentResult>();
		const agent = runtimeMock(() => active.promise);
		// biome-ignore lint/complexity/useArrowFunction: production constructs SessionRuntime with `new`.
		createSessionRuntimeMock.mockImplementationOnce(function () {
			return agent;
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "team",
			maxConcurrentRuns: 1,
			maxQueuedRuns: 1,
			maxRunMessageBytes: 5,
		});
		runtime.spawnTeammate({ agentId: "alice", config: teammateConfig });
		runtime.startTeammateRun("alice", "one");
		runtime.startTeammateRun("alice", "two");

		expect(() => runtime.startTeammateRun("alice", "three")).toThrow(
			expect.objectContaining<Partial<TeamRunAdmissionError>>({
				limit: "queued_count",
			}),
		);
		expect(() => runtime.startTeammateRun("alice", "123456")).toThrow(
			expect.objectContaining<Partial<TeamRunAdmissionError>>({
				limit: "message_bytes",
			}),
		);
	});

	it.each(["resolve", "reject"] as const)(
		"keeps cancellation stable when the physical run later %ss",
		async (settlement) => {
			const physical = deferred<AgentResult>();
			const next = deferred<AgentResult>();
			const alice = runtimeMock(() => physical.promise);
			const bob = runtimeMock(() => next.promise);
			createSessionRuntimeMock
				// biome-ignore lint/complexity/useArrowFunction: production constructs SessionRuntime with `new`.
				.mockImplementationOnce(function () {
					return alice;
				})
				// biome-ignore lint/complexity/useArrowFunction: production constructs SessionRuntime with `new`.
				.mockImplementationOnce(function () {
					return bob;
				});
			const runtime = new AgentTeamsRuntime({
				teamName: "team",
				maxConcurrentRuns: 1,
			});
			runtime.spawnTeammate({ agentId: "alice", config: teammateConfig });
			runtime.spawnTeammate({ agentId: "bob", config: teammateConfig });
			const cancelled = runtime.startTeammateRun("alice", "cancel me", {
				maxRetries: 2,
			});
			const queued = runtime.startTeammateRun("bob", "wait for capacity");

			const firstCancellation = runtime.cancelRun(cancelled.id, "stop now");
			const secondCancellation = runtime.cancelRun(
				cancelled.id,
				"different reason",
			);
			expect(firstCancellation).toEqual(secondCancellation);
			expect(alice.abort).toHaveBeenCalledTimes(1);
			expect(bob.run).not.toHaveBeenCalled();

			if (settlement === "resolve") physical.resolve(result("late success"));
			else physical.reject(new Error("late failure"));
			await flush();

			expect(runtime.getRun(cancelled.id)).toEqual(
				expect.objectContaining({
					status: "cancelled",
					error: "stop now",
					retryCount: 0,
				}),
			);
			expect(bob.run).toHaveBeenCalledTimes(1);
			expect(runtime.getRun(queued.id)?.status).toBe("running");
		},
	);
});
