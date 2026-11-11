import type {
	AgentUsage,
	AsideContext,
	AsideRequest,
	AsideResult,
	AsideUsage,
	BasicLogger,
} from "@cline/shared";
import type {
	ForkRequest,
	ForkResult,
	ModelAnswer,
} from "../runtime/orchestration/ephemeral-fork";
import type { FreshRequest } from "../runtime/orchestration/fresh-request";

export const ASIDES_PER_HOUR = 20;
export const ASIDE_DEFAULT_TIMEOUT_MS = 20_000;
export const ASIDE_MAX_TIMEOUT_MS = 60_000;
export const ASIDE_DEFAULT_MAX_OUTPUT_TOKENS = 400;
export const ASIDE_MAX_OUTPUT_TOKENS = 4_000;

const HOUR_MS = 3_600_000;
const BUDGET_SWEEP_THRESHOLD = 256;

/** The part of a session's root runtime that answers an aside. */
export interface AsideSession {
	/** Whether no later run has begun: the run is in progress or was the last to finish. */
	isLatestRun(runId: string): boolean;
	fork(request: ForkRequest): Promise<ForkResult>;
	askFresh(request: FreshRequest): Promise<ModelAnswer>;
}

export interface AsideServiceOptions {
	/** The kill switch: `false` skips every aside as `disabled`. */
	enabled?: () => boolean;
	callsPerHour?: number;
	now?: () => number;
	logger?: BasicLogger;
}

type AbortCause = "timeout" | "superseded";
type BudgetSlot = { at: number };
type ParsedAsideRequest = Pick<AsideRequest, "runId" | "system"> &
	Required<Omit<AsideRequest, "runId" | "system">>;

const CONTEXTS: readonly AsideContext[] = ["chat", "none"];

function boundedInteger(
	value: unknown,
	fallback: number,
	max: number,
): number | undefined {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const whole = Math.floor(value);
	return whole >= 1 ? Math.min(whole, max) : undefined;
}

/** A plugin's request crossed the sandbox as plain data: nothing about its shape is known until it is checked here. */
export function parseAsideRequest(value: unknown): ParsedAsideRequest {
	if (typeof value !== "object" || value === null)
		throw new Error("an aside request must be an object");
	const {
		runId,
		context = "chat",
		prompt,
		system,
		maxOutputTokens,
		timeoutMs,
	} = value as Record<string, unknown>;
	if (runId !== undefined && (typeof runId !== "string" || !runId))
		throw new Error("an aside request's runId must be a non-empty string");
	// An unknown context must not fall back to a replay of the whole chat the
	// plugin did not ask for.
	if (!CONTEXTS.includes(context as AsideContext))
		throw new Error('an aside request\'s context is "chat" or "none"');
	if (typeof prompt !== "string" || !prompt.trim())
		throw new Error("an aside request needs a prompt");
	if (system !== undefined && typeof system !== "string")
		throw new Error("an aside request's system prompt must be a string");
	const outputCap = boundedInteger(
		maxOutputTokens,
		ASIDE_DEFAULT_MAX_OUTPUT_TOKENS,
		ASIDE_MAX_OUTPUT_TOKENS,
	);
	if (outputCap === undefined)
		throw new Error("an aside request's maxOutputTokens must be at least 1");
	const timeout = boundedInteger(
		timeoutMs,
		ASIDE_DEFAULT_TIMEOUT_MS,
		ASIDE_MAX_TIMEOUT_MS,
	);
	if (timeout === undefined)
		throw new Error("an aside request's timeoutMs must be at least 1");
	return {
		...(runId === undefined ? {} : { runId }),
		context: context as AsideContext,
		prompt,
		...(system ? { system } : {}),
		maxOutputTokens: outputCap,
		timeoutMs: timeout,
	};
}

function toAsideUsage(usage: AgentUsage): AsideUsage {
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cacheReadTokens: usage.cacheReadTokens,
		cacheWriteTokens: usage.cacheWriteTokens,
		...(usage.totalCost === undefined ? {} : { costUsd: usage.totalCost }),
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function endedBy(signal: AbortSignal): AsideResult {
	return { status: signal.reason === "timeout" ? "timeout" : "superseded" };
}

/** Settles when the aside is ended, so a model call that ignores its signal cannot hold the aside open. */
function whenEnded(signal: AbortSignal): Promise<AsideResult> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve(endedBy(signal));
		signal.addEventListener("abort", () => resolve(endedBy(signal)), {
			once: true,
		});
	});
}

/**
 * Answers the asides plugins ask about a host's sessions. It decides whether
 * an aside may spend anything (the kill switch and each plugin's hourly
 * allowance per chat), bounds how long and how much it may answer, and ends
 * the ones in flight when their chat moves on.
 */
export class AsideService {
	private readonly enabled: () => boolean;
	private readonly callsPerHour: number;
	private readonly now: () => number;
	private readonly logger?: BasicLogger;
	/** Calls of the last hour, in flight ones included, by chat and plugin. */
	private readonly budgets = new Map<string, BudgetSlot[]>();
	private readonly inFlight = new Map<string, Set<AbortController>>();

	constructor(options: AsideServiceOptions = {}) {
		this.enabled = options.enabled ?? (() => true);
		this.callsPerHour = options.callsPerHour ?? ASIDES_PER_HOUR;
		this.now = options.now ?? Date.now;
		this.logger = options.logger;
	}

	/** Never rejects. `session` is undefined when the chat has no runtime to ask. */
	async ask(
		sessionId: string,
		session: AsideSession | undefined,
		ask: { pluginName: string; request: unknown },
	): Promise<AsideResult> {
		let request: ParsedAsideRequest;
		try {
			request = parseAsideRequest(ask.request);
		} catch (error) {
			return { status: "error", error: errorMessage(error) };
		}
		if (!this.enabled()) return { status: "skipped", reason: "disabled" };
		if (!session) return { status: "skipped", reason: "unsupported" };
		if (request.runId !== undefined && !session.isLatestRun(request.runId))
			return { status: "skipped", reason: "stale_run" };
		const slot = this.reserve(`${sessionId}\n${ask.pluginName}`);
		if (!slot) return { status: "skipped", reason: "budget" };

		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort("timeout" satisfies AbortCause),
			request.timeoutMs,
		);
		const inFlight = this.inFlight.get(sessionId) ?? new Set();
		this.inFlight.set(sessionId, inFlight);
		inFlight.add(controller);
		const startedAt = this.now();
		let result: AsideResult;
		try {
			result = await Promise.race([
				this.send(session, request, controller.signal).catch(
					(error): AsideResult => ({
						status: "error",
						error: errorMessage(error),
					}),
				),
				whenEnded(controller.signal),
			]);
		} finally {
			clearTimeout(timer);
			inFlight.delete(controller);
			if (inFlight.size === 0) this.inFlight.delete(sessionId);
		}
		if (result.status === "skipped") slot.release();
		this.logger?.debug("aside", {
			sessionId,
			pluginName: ask.pluginName,
			runId: request.runId,
			context: request.context,
			status: result.status,
			...(result.status === "skipped" ? { reason: result.reason } : {}),
			...(result.status === "ok"
				? { transport: result.transport, ...result.usage }
				: {}),
			totalMs: this.now() - startedAt,
		});
		return result;
	}

	/** The chat moved on: a new run began or the session ended. */
	supersede(sessionId: string): void {
		for (const controller of this.inFlight.get(sessionId) ?? [])
			controller.abort("superseded" satisfies AbortCause);
	}

	private async send(
		session: AsideSession,
		request: ParsedAsideRequest,
		signal: AbortSignal,
	): Promise<AsideResult> {
		if (request.context === "none") {
			try {
				const answer = await session.askFresh({
					system: request.system,
					prompt: request.prompt,
					maxOutputTokens: request.maxOutputTokens,
					signal,
				});
				if (signal.aborted) return endedBy(signal);
				return {
					status: "ok",
					text: answer.text,
					transport: "fresh",
					usage: toAsideUsage(answer.usage),
					calledTools: answer.calledTools,
				};
			} catch (error) {
				if (signal.aborted) return endedBy(signal);
				return { status: "error", error: errorMessage(error) };
			}
		}
		const fork = await session.fork({
			runId: request.runId,
			instruction: request.prompt,
			maxOutputTokens: request.maxOutputTokens,
			signal,
		});
		if (!("unavailable" in fork))
			return {
				status: "ok",
				text: fork.text,
				transport: "replay",
				usage: toAsideUsage(fork.usage),
				calledTools: fork.calledTools,
			};
		switch (fork.unavailable) {
			case "aborted":
				return endedBy(signal);
			case "provider_error":
				return {
					status: "error",
					...(fork.error ? { error: fork.error } : {}),
				};
			default:
				return { status: "skipped", reason: fork.unavailable };
		}
	}

	/** Holds one of the hour's calls, or undefined when they are used. A call in flight already counts. */
	private reserve(key: string): { release(): void } | undefined {
		const since = this.now() - HOUR_MS;
		if (this.budgets.size > BUDGET_SWEEP_THRESHOLD) {
			for (const [other, slots] of this.budgets) {
				if (!slots.some((slot) => slot.at > since)) this.budgets.delete(other);
			}
		}
		const slots = this.budgets.get(key) ?? [];
		this.budgets.set(key, slots);
		while (slots[0] && slots[0].at <= since) slots.shift();
		if (slots.length >= this.callsPerHour) return undefined;
		const held: BudgetSlot = { at: this.now() };
		slots.push(held);
		return {
			release: () => {
				const index = slots.indexOf(held);
				if (index !== -1) slots.splice(index, 1);
			},
		};
	}
}
