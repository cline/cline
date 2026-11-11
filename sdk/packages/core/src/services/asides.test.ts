import type { AgentUsage, BasicLogger } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ForkRequest,
	ForkResult,
} from "../runtime/orchestration/ephemeral-fork";
import {
	ASIDE_DEFAULT_MAX_OUTPUT_TOKENS,
	ASIDE_DEFAULT_TIMEOUT_MS,
	ASIDE_MAX_OUTPUT_TOKENS,
	ASIDE_MAX_TIMEOUT_MS,
	AsideService,
	type AsideSession,
	parseAsideRequest,
} from "./asides";

const usage: AgentUsage = {
	inputTokens: 100,
	outputTokens: 5,
	cacheReadTokens: 90,
	cacheWriteTokens: 0,
	totalCost: 0.002,
};

const asideUsage = {
	inputTokens: 100,
	outputTokens: 5,
	cacheReadTokens: 90,
	cacheWriteTokens: 0,
	costUsd: 0.002,
};

function untilAborted<T>(signal: AbortSignal | undefined, value: T) {
	return new Promise<T>((resolve) => {
		signal?.addEventListener("abort", () => resolve(value), { once: true });
	});
}

function makeSession(overrides: Partial<AsideSession> = {}) {
	const forks: ForkRequest[] = [];
	const session: AsideSession = {
		isLatestRun: () => true,
		fork: async (request): Promise<ForkResult> => {
			forks.push(request);
			return {
				runId: request.runId ?? "run-latest",
				text: "Run the tests",
				usage,
				calledTools: [],
			};
		},
		...overrides,
	};
	return { session, forks };
}

const chat = { runId: "run-1", prompt: "What next?" };
const ask = (request: unknown = chat, pluginName = "asker") => ({
	pluginName,
	request,
});

describe("parseAsideRequest", () => {
	it("fills the output cap and timeout a request leaves out", () => {
		expect(parseAsideRequest(chat)).toEqual({
			...chat,
			maxOutputTokens: ASIDE_DEFAULT_MAX_OUTPUT_TOKENS,
			timeoutMs: ASIDE_DEFAULT_TIMEOUT_MS,
		});
	});

	it("clamps an output cap and a timeout above the host's limits", () => {
		expect(
			parseAsideRequest({
				...chat,
				maxOutputTokens: 1_000_000,
				timeoutMs: 3_600_000,
			}),
		).toMatchObject({
			maxOutputTokens: ASIDE_MAX_OUTPUT_TOKENS,
			timeoutMs: ASIDE_MAX_TIMEOUT_MS,
		});
	});

	it("takes a request that names no run, or names the chat as its context", () => {
		expect(parseAsideRequest({ prompt: "What next?" })).toEqual({
			prompt: "What next?",
			maxOutputTokens: ASIDE_DEFAULT_MAX_OUTPUT_TOKENS,
			timeoutMs: ASIDE_DEFAULT_TIMEOUT_MS,
		});
		expect(parseAsideRequest({ ...chat, context: "chat" })).toMatchObject(chat);
	});

	it.each([
		["not an object", "ask"],
		["an empty runId", { ...chat, runId: "" }],
		["a runId that is not text", { ...chat, runId: 7 }],
		["a context this host does not offer", { ...chat, context: "none" }],
		["a blank prompt", { ...chat, prompt: "  " }],
		["a negative output cap", { ...chat, maxOutputTokens: -1 }],
		["an output cap below one token", { ...chat, maxOutputTokens: 0.5 }],
		["a timeout below one millisecond", { ...chat, timeoutMs: 0.5 }],
		["a timeout that is not a number", { ...chat, timeoutMs: "soon" }],
	])("rejects %s", (_name, request) => {
		expect(() => parseAsideRequest(request)).toThrow();
	});
});

describe("AsideService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("answers a chat aside from a fork of the run", async () => {
		const { session, forks } = makeSession();

		const result = await new AsideService().ask("s1", session, ask());

		expect(result).toEqual({
			status: "ok",
			text: "Run the tests",
			usage: asideUsage,
			calledTools: [],
		});
		expect(forks).toEqual([
			{
				runId: "run-1",
				instruction: "What next?",
				maxOutputTokens: ASIDE_DEFAULT_MAX_OUTPUT_TOKENS,
				signal: expect.any(AbortSignal),
			},
		]);
	});

	it("asks about the latest run when the request names none", async () => {
		const isLatestRun = vi.fn(() => false);
		const { session, forks } = makeSession({ isLatestRun });

		const result = await new AsideService().ask(
			"s1",
			session,
			ask({ prompt: "What next?" }),
		);

		expect(result).toMatchObject({ status: "ok", text: "Run the tests" });
		expect(forks).toEqual([
			{
				instruction: "What next?",
				maxOutputTokens: ASIDE_DEFAULT_MAX_OUTPUT_TOKENS,
				signal: expect.any(AbortSignal),
			},
		]);
		expect(isLatestRun).not.toHaveBeenCalled();
	});

	it("reports a request it cannot read as an error without calling the model", async () => {
		const { session, forks } = makeSession();

		const result = await new AsideService().ask("s1", session, ask({}));

		expect(result).toMatchObject({ status: "error" });
		expect(forks).toEqual([]);
	});

	it("skips every aside while asides are turned off", async () => {
		const { session, forks } = makeSession();
		const service = new AsideService({ enabled: () => false });

		expect(await service.ask("s1", session, ask())).toEqual({
			status: "skipped",
			reason: "disabled",
		});
		expect(forks).toEqual([]);
	});

	it("skips an aside for a chat that has no runtime", async () => {
		expect(await new AsideService().ask("s1", undefined, ask())).toEqual({
			status: "skipped",
			reason: "unsupported",
		});
	});

	it("gives each plugin its own hourly allowance per chat", async () => {
		let now = 1_000_000;
		const { session, forks } = makeSession();
		const service = new AsideService({ callsPerHour: 2, now: () => now });

		await service.ask("s1", session, ask());
		await service.ask("s1", session, ask());
		expect(await service.ask("s1", session, ask())).toEqual({
			status: "skipped",
			reason: "budget",
		});
		expect(await service.ask("s1", session, ask(chat, "tutor"))).toMatchObject({
			status: "ok",
		});
		expect(await service.ask("s2", session, ask())).toMatchObject({
			status: "ok",
		});

		now += 3_600_001;
		expect(await service.ask("s1", session, ask())).toMatchObject({
			status: "ok",
		});
		expect(forks).toHaveLength(5);
	});

	it.each([
		"no_recorded_request",
		"stale_run",
		"no_prompt_cache",
	] as const)("does not charge the allowance for a fork that was never sent (%s)", async (reason) => {
		const { session } = makeSession({
			fork: async (request) => ({ runId: request.runId, unavailable: reason }),
		});
		const service = new AsideService({ callsPerHour: 1 });

		expect(await service.ask("s1", session, ask())).toEqual({
			status: "skipped",
			reason,
		});
		expect(await service.ask("s1", session, ask())).toEqual({
			status: "skipped",
			reason,
		});
	});

	it("charges the allowance for an aside the provider failed", async () => {
		const { session } = makeSession({
			fork: async (request) => ({
				runId: request.runId,
				unavailable: "provider_error",
				error: "overloaded",
			}),
		});
		const service = new AsideService({ callsPerHour: 1 });

		expect(await service.ask("s1", session, ask())).toEqual({
			status: "error",
			error: "overloaded",
		});
		expect(await service.ask("s1", session, ask())).toEqual({
			status: "skipped",
			reason: "budget",
		});
	});

	it("ends an aside that outlasts its timeout", async () => {
		const { session } = makeSession({
			fork: (request) =>
				untilAborted(request.signal, {
					runId: request.runId,
					unavailable: "aborted",
				}),
		});

		const pending = new AsideService().ask(
			"s1",
			session,
			ask({ ...chat, timeoutMs: 5_000 }),
		);
		await vi.advanceTimersByTimeAsync(5_000);

		expect(await pending).toEqual({ status: "timeout" });
	});

	it("ends an aside in flight when its chat moves on, and leaves other chats alone", async () => {
		const { session } = makeSession({
			fork: (request) =>
				untilAborted(request.signal, {
					runId: request.runId,
					unavailable: "aborted",
				}),
		});
		const service = new AsideService();

		const moved = service.ask("s1", session, ask());
		const other = service.ask("s2", session, ask());
		await vi.advanceTimersByTimeAsync(0);
		service.supersede("s1");

		expect(await moved).toEqual({ status: "superseded" });
		await vi.advanceTimersByTimeAsync(ASIDE_DEFAULT_TIMEOUT_MS);
		expect(await other).toEqual({ status: "timeout" });
	});

	it("skips an aside about a run the chat has moved past, without charging it", async () => {
		const { session, forks } = makeSession({
			isLatestRun: (runId) => runId === "run-2",
		});
		const service = new AsideService({ callsPerHour: 1 });

		expect(await service.ask("s1", session, ask())).toEqual({
			status: "skipped",
			reason: "stale_run",
		});
		expect(
			await service.ask("s1", session, ask({ ...chat, runId: "run-2" })),
		).toMatchObject({ status: "ok" });
		expect(forks).toHaveLength(1);
	});

	it("ends an aside on time when its model call ignores the abort, and still charges it", async () => {
		const { session } = makeSession({
			fork: () => new Promise(() => {}),
		});
		const service = new AsideService({ callsPerHour: 1 });

		const stuck = service.ask(
			"s1",
			session,
			ask({ ...chat, timeoutMs: 5_000 }),
		);
		await vi.advanceTimersByTimeAsync(5_000);

		expect(await stuck).toEqual({ status: "timeout" });
		expect(await service.ask("s1", session, ask())).toEqual({
			status: "skipped",
			reason: "budget",
		});
	});

	it("reports a fork the next run aborted as superseded", async () => {
		const { session } = makeSession({
			fork: async (request) => ({
				runId: request.runId,
				unavailable: "aborted",
			}),
		});

		expect(await new AsideService().ask("s1", session, ask())).toEqual({
			status: "superseded",
		});
	});

	it("reports a model call that throws as an error", async () => {
		const { session } = makeSession({
			fork: async () => {
				throw new Error("401 unauthorized");
			},
		});

		expect(await new AsideService().ask("s1", session, ask())).toEqual({
			status: "error",
			error: "401 unauthorized",
		});
	});

	it("logs what an aside spent and never what it said", async () => {
		const debug = vi.fn();
		const logger = { debug, log: vi.fn(), error: vi.fn() } as BasicLogger;
		const { session } = makeSession();

		await new AsideService({ logger, now: () => 42 }).ask("s1", session, ask());

		expect(debug).toHaveBeenCalledWith("aside", {
			sessionId: "s1",
			pluginName: "asker",
			runId: "run-1",
			status: "ok",
			...asideUsage,
			totalMs: 0,
		});
	});
});
