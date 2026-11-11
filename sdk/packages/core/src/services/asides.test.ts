import type { AgentUsage, BasicLogger } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ForkRequest,
	ForkResult,
} from "../runtime/orchestration/ephemeral-fork";
import type { FreshRequest } from "../runtime/orchestration/fresh-request";
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
	const fresh: FreshRequest[] = [];
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
		askFresh: async (request) => {
			fresh.push(request);
			return { text: "Plan the work", usage, calledTools: [] };
		},
		...overrides,
	};
	return { session, forks, fresh };
}

const chat = { runId: "run-1", prompt: "What next?" };
const none = { runId: "run-1", context: "none", prompt: "Plan it." };
const ask = (request: unknown = chat, pluginName = "asker") => ({
	pluginName,
	request,
});

describe("parseAsideRequest", () => {
	it("fills the output cap and timeout a request leaves out", () => {
		expect(parseAsideRequest(chat)).toEqual({
			...chat,
			context: "chat",
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

	it("reads a request that names no run and no context as a question about the chat", () => {
		expect(parseAsideRequest({ prompt: "What next?" })).toEqual({
			context: "chat",
			prompt: "What next?",
			maxOutputTokens: ASIDE_DEFAULT_MAX_OUTPUT_TOKENS,
			timeoutMs: ASIDE_DEFAULT_TIMEOUT_MS,
		});
	});

	it.each([
		["not an object", "ask"],
		["an empty runId", { ...chat, runId: "" }],
		["a runId that is not text", { ...chat, runId: 7 }],
		["an unknown context", { ...chat, context: "everything" }],
		["a blank prompt", { ...chat, prompt: "  " }],
		["a system prompt that is not text", { ...none, system: 7 }],
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
		const { session, forks, fresh } = makeSession();

		const result = await new AsideService().ask("s1", session, ask());

		expect(result).toEqual({
			status: "ok",
			text: "Run the tests",
			transport: "replay",
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
		expect(fresh).toEqual([]);
	});

	it("answers a none aside from a fresh request that carries its system prompt", async () => {
		const { session, forks, fresh } = makeSession();

		const result = await new AsideService().ask(
			"s1",
			session,
			ask({
				context: "none",
				system: "You plan.",
				prompt: "Plan it.",
				maxOutputTokens: 200,
			}),
		);

		expect(result).toMatchObject({
			status: "ok",
			text: "Plan the work",
			transport: "fresh",
		});
		expect(fresh).toEqual([
			{
				system: "You plan.",
				prompt: "Plan it.",
				maxOutputTokens: 200,
				signal: expect.any(AbortSignal),
			},
		]);
		expect(forks).toEqual([]);
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

	it.each([
		["chat", chat],
		["none", none],
	])("ends a %s aside in flight when its chat moves on, and leaves other chats alone", async (_context, request) => {
		const { session } = makeSession({
			fork: (request) =>
				untilAborted(request.signal, {
					runId: request.runId,
					unavailable: "aborted",
				}),
			askFresh: async (request) => {
				await untilAborted(request.signal, undefined);
				throw new Error("aborted");
			},
		});
		const service = new AsideService();

		const moved = service.ask("s1", session, ask(request));
		const other = service.ask("s2", session, ask(request));
		await vi.advanceTimersByTimeAsync(0);
		service.supersede("s1");

		expect(await moved).toEqual({ status: "superseded" });
		await vi.advanceTimersByTimeAsync(ASIDE_DEFAULT_TIMEOUT_MS);
		expect(await other).toEqual({ status: "timeout" });
	});

	it.each([
		["chat", chat],
		["none", none],
	])("skips a %s aside about a run the chat has moved past, without charging it", async (_context, request) => {
		const { session, forks, fresh } = makeSession({
			isLatestRun: (runId) => runId === "run-2",
		});
		const service = new AsideService({ callsPerHour: 1 });

		expect(await service.ask("s1", session, ask(request))).toEqual({
			status: "skipped",
			reason: "stale_run",
		});
		expect(
			await service.ask("s1", session, ask({ ...request, runId: "run-2" })),
		).toMatchObject({ status: "ok" });
		expect([...forks, ...fresh]).toHaveLength(1);
	});

	it.each([
		["chat", chat],
		["none", none],
	])("ends a %s aside on time when its model call ignores the abort, and still charges it", async (_context, request) => {
		const { session } = makeSession({
			fork: () => new Promise(() => {}),
			askFresh: () => new Promise(() => {}),
		});
		const service = new AsideService({ callsPerHour: 1 });

		const stuck = service.ask(
			"s1",
			session,
			ask({ ...request, timeoutMs: 5_000 }),
		);
		await vi.advanceTimersByTimeAsync(5_000);

		expect(await stuck).toEqual({ status: "timeout" });
		expect(await service.ask("s1", session, ask(request))).toEqual({
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

	it.each([
		["chat", chat],
		["none", none],
	])("reports a %s aside whose model call throws as an error", async (_context, request) => {
		const failed = async () => {
			throw new Error("401 unauthorized");
		};
		const { session } = makeSession({ fork: failed, askFresh: failed });

		expect(await new AsideService().ask("s1", session, ask(request))).toEqual({
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
			context: "chat",
			status: "ok",
			transport: "replay",
			...asideUsage,
			totalMs: 0,
		});
	});
});
