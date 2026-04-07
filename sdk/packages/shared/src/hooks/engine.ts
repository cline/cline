import type {
	HookControl,
	HookDispatchResult,
	HookEventEnvelope,
	HookHandlerResult,
	HookPolicies,
	HookStage,
	HookStagePolicy,
	HookStagePolicyInput,
} from "./contracts";

export interface HookHandler {
	name: string;
	stage: HookStage;
	priority?: number;
	handle: (
		event: HookEventEnvelope,
	) => Promise<HookControl | undefined> | HookControl | undefined;
}

export interface HookDispatchInput<TPayload = unknown> {
	stage: HookStage;
	runId: string;
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration?: number;
	parentEventId?: string;
	payload: TPayload;
}

export interface HookEngineOptions {
	policies?: HookPolicies;
	onDispatchError?: (
		error: Error,
		event: HookEventEnvelope,
		handlerName: string,
	) => void;
	onDroppedEvent?: (event: HookEventEnvelope, policy: HookStagePolicy) => void;
}

interface QueueItem {
	event: HookEventEnvelope;
	stagePolicy: HookStagePolicy;
	handlers: HookHandler[];
}

interface StageQueueState {
	activeCount: number;
	items: QueueItem[];
}

function compareHandlers(a: HookHandler, b: HookHandler): number {
	const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
	if (priorityDiff !== 0) {
		return priorityDiff;
	}
	return a.name.localeCompare(b.name);
}

const STAGE_DEFAULTS: Record<HookStage, HookStagePolicy> = {
	input: {
		mode: "blocking",
		timeoutMs: 2500,
		retries: 0,
		retryDelayMs: 100,
		failureMode: "fail_open",
		maxConcurrency: 1,
		queueLimit: 100,
	},
	runtime_event: {
		mode: "async",
		timeoutMs: 1500,
		retries: 0,
		retryDelayMs: 100,
		failureMode: "fail_open",
		maxConcurrency: 4,
		queueLimit: 2000,
	},
	session_start: {
		mode: "blocking",
		timeoutMs: 2500,
		retries: 0,
		retryDelayMs: 100,
		failureMode: "fail_open",
		maxConcurrency: 1,
		queueLimit: 100,
	},
	run_start: {
		mode: "blocking",
		timeoutMs: 2500,
		retries: 0,
		retryDelayMs: 100,
		failureMode: "fail_open",
		maxConcurrency: 1,
		queueLimit: 100,
	},
	iteration_start: {
		mode: "blocking",
		timeoutMs: 2000,
		retries: 0,
		retryDelayMs: 100,
		failureMode: "fail_open",
		maxConcurrency: 1,
		queueLimit: 200,
	},
	turn_start: {
		mode: "blocking",
		timeoutMs: 2000,
		retries: 0,
		retryDelayMs: 100,
		failureMode: "fail_open",
		maxConcurrency: 1,
		queueLimit: 200,
	},
	before_agent_start: {
		mode: "blocking",
		timeoutMs: 3000,
		retries: 0,
		retryDelayMs: 100,
		failureMode: "fail_open",
		maxConcurrency: 1,
		queueLimit: 200,
	},
	tool_call_before: {
		mode: "blocking",
		timeoutMs: 4000,
		retries: 1,
		retryDelayMs: 150,
		failureMode: "fail_open",
		maxConcurrency: 1,
		queueLimit: 500,
	},
	tool_call_after: {
		mode: "blocking",
		timeoutMs: 3000,
		retries: 1,
		retryDelayMs: 200,
		failureMode: "fail_open",
		maxConcurrency: 1,
		queueLimit: 1000,
	},
	turn_end: {
		mode: "blocking",
		timeoutMs: 3000,
		retries: 1,
		retryDelayMs: 200,
		failureMode: "fail_open",
		maxConcurrency: 1,
		queueLimit: 500,
	},
	stop_error: {
		mode: "async",
		timeoutMs: 3000,
		retries: 1,
		retryDelayMs: 200,
		failureMode: "fail_open",
		maxConcurrency: 2,
		queueLimit: 500,
	},
	iteration_end: {
		mode: "async",
		timeoutMs: 3000,
		retries: 1,
		retryDelayMs: 200,
		failureMode: "fail_open",
		maxConcurrency: 2,
		queueLimit: 500,
	},
	run_end: {
		mode: "async",
		timeoutMs: 3000,
		retries: 1,
		retryDelayMs: 200,
		failureMode: "fail_open",
		maxConcurrency: 2,
		queueLimit: 500,
	},
	session_shutdown: {
		mode: "async",
		timeoutMs: 3000,
		retries: 1,
		retryDelayMs: 200,
		failureMode: "fail_open",
		maxConcurrency: 2,
		queueLimit: 500,
	},
	error: {
		mode: "async",
		timeoutMs: 1500,
		retries: 0,
		retryDelayMs: 100,
		failureMode: "fail_open",
		maxConcurrency: 2,
		queueLimit: 500,
	},
};

function mergeControl(
	base: HookControl | undefined,
	next: HookControl | undefined,
): HookControl | undefined {
	if (!base && !next) {
		return undefined;
	}

	const appendMessages = [
		...(Array.isArray(base?.appendMessages) ? base.appendMessages : []),
		...(Array.isArray(next?.appendMessages) ? next.appendMessages : []),
	];
	const replaceMessages = Object.hasOwn(next ?? {}, "replaceMessages")
		? next?.replaceMessages
		: base?.replaceMessages;

	const merged: HookControl = {
		cancel: !!(base?.cancel || next?.cancel),
		review: !!(base?.review || next?.review),
		context: [base?.context, next?.context]
			.filter((value): value is string => typeof value === "string" && !!value)
			.join("\n"),
		overrideInput: Object.hasOwn(next ?? {}, "overrideInput")
			? next?.overrideInput
			: base?.overrideInput,
	};

	const systemPrompt =
		typeof next?.systemPrompt === "string"
			? next.systemPrompt
			: base?.systemPrompt;
	if (typeof systemPrompt === "string") {
		merged.systemPrompt = systemPrompt;
	}
	if (appendMessages.length > 0) {
		merged.appendMessages = appendMessages;
	}
	if (Array.isArray(replaceMessages)) {
		merged.replaceMessages = replaceMessages;
	}
	return merged;
}

function normalizePolicy(
	base: HookStagePolicy,
	patch?: HookStagePolicyInput,
): HookStagePolicy {
	return {
		mode: patch?.mode ?? base.mode,
		timeoutMs: patch?.timeoutMs ?? base.timeoutMs,
		retries: patch?.retries ?? base.retries,
		retryDelayMs: patch?.retryDelayMs ?? base.retryDelayMs,
		failureMode: patch?.failureMode ?? base.failureMode,
		maxConcurrency: Math.max(1, patch?.maxConcurrency ?? base.maxConcurrency),
		queueLimit: Math.max(1, patch?.queueLimit ?? base.queueLimit),
	};
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function isControl(value: unknown): value is HookControl {
	return !!value && typeof value === "object";
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	handlerName: string,
	stage: HookStage,
): Promise<T> {
	if (timeoutMs <= 0) {
		return await promise;
	}
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					reject(
						new Error(
							`Hook handler "${handlerName}" timed out after ${timeoutMs}ms at stage "${stage}"`,
						),
					);
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

export class HookEngine {
	private readonly handlers = new Map<HookStage, HookHandler[]>();
	private readonly options: HookEngineOptions;
	private sequence = 0;
	private eventCounter = 0;
	private readonly stageQueues = new Map<HookStage, StageQueueState>();
	private readonly inFlight = new Set<Promise<void>>();

	constructor(options: HookEngineOptions = {}) {
		this.options = options;
	}

	register(handler: HookHandler): void {
		const list = this.handlers.get(handler.stage) ?? [];
		list.push(handler);
		list.sort(compareHandlers);
		this.handlers.set(handler.stage, list);
	}

	async dispatch<TPayload>(
		input: HookDispatchInput<TPayload>,
	): Promise<HookDispatchResult> {
		const event: HookEventEnvelope<TPayload> = {
			eventId: `hook_evt_${String(++this.eventCounter).padStart(8, "0")}`,
			stage: input.stage,
			createdAt: new Date(),
			sequence: ++this.sequence,
			runId: input.runId,
			agentId: input.agentId,
			conversationId: input.conversationId,
			parentAgentId: input.parentAgentId,
			iteration: input.iteration,
			parentEventId: input.parentEventId,
			payload: input.payload,
		};

		const handlers = this.getHandlers(input.stage);
		if (handlers.length === 0) {
			return {
				event,
				queued: false,
				dropped: false,
				control: undefined,
				results: [],
			};
		}

		const stagePolicy = this.resolveStagePolicy(input.stage);
		if (stagePolicy.mode === "async") {
			const state = this.getStageQueueState(input.stage);
			if (state.items.length >= stagePolicy.queueLimit) {
				this.options.onDroppedEvent?.(event, stagePolicy);
				return {
					event,
					queued: false,
					dropped: true,
					control: undefined,
					results: [],
				};
			}

			state.items.push({ event, stagePolicy, handlers });
			this.kickQueue(input.stage);
			return {
				event,
				queued: true,
				dropped: false,
				control: undefined,
				results: [],
			};
		}

		const results = await this.executeHandlers(event, handlers, stagePolicy);
		return {
			event,
			queued: false,
			dropped: false,
			control: this.mergeControlsFromResults(results),
			results,
		};
	}

	async shutdown(drainTimeoutMs = 3000): Promise<void> {
		const start = Date.now();
		while (this.inFlight.size > 0) {
			if (Date.now() - start >= drainTimeoutMs) {
				break;
			}
			await Promise.race([...this.inFlight]);
		}
	}

	private getHandlers(stage: HookStage): HookHandler[] {
		const handlers = this.handlers.get(stage) ?? [];
		return [...handlers];
	}

	private getStageQueueState(stage: HookStage): StageQueueState {
		const existing = this.stageQueues.get(stage);
		if (existing) {
			return existing;
		}
		const created: StageQueueState = { activeCount: 0, items: [] };
		this.stageQueues.set(stage, created);
		return created;
	}

	private kickQueue(stage: HookStage): void {
		const state = this.getStageQueueState(stage);
		const stagePolicy = this.resolveStagePolicy(stage);
		while (
			state.activeCount < stagePolicy.maxConcurrency &&
			state.items.length > 0
		) {
			const item = state.items.shift();
			if (!item) {
				return;
			}
			state.activeCount += 1;
			const job: Promise<void> = this.executeHandlers(
				item.event,
				item.handlers,
				item.stagePolicy,
			)
				.then(() => undefined)
				.catch(() => {
					// Failures are already surfaced via onDispatchError.
				})
				.finally(() => {
					state.activeCount -= 1;
					this.inFlight.delete(job);
					this.kickQueue(stage);
				});
			this.inFlight.add(job);
		}
	}

	private resolveStagePolicy(stage: HookStage): HookStagePolicy {
		const base = normalizePolicy(
			STAGE_DEFAULTS[stage],
			this.options.policies?.defaultPolicy,
		);
		return normalizePolicy(base, this.options.policies?.stages?.[stage]);
	}

	private resolveHandlerPolicy(
		stage: HookStage,
		handlerName: string,
	): HookStagePolicy {
		const stagePolicy = this.resolveStagePolicy(stage);
		return normalizePolicy(
			stagePolicy,
			this.options.policies?.handlers?.[handlerName],
		);
	}

	private async executeHandlers(
		event: HookEventEnvelope,
		handlers: HookHandler[],
		stagePolicy: HookStagePolicy,
	): Promise<HookHandlerResult[]> {
		const results: HookHandlerResult[] = [];

		for (const handler of handlers) {
			const policy = this.resolveHandlerPolicy(event.stage, handler.name);
			if (stagePolicy.mode === "async" && policy.mode === "blocking") {
				results.push({
					handlerName: handler.name,
					stage: event.stage,
					status: "skipped",
					attempts: 0,
					durationMs: 0,
				});
				continue;
			}

			const result = await this.executeHandler(event, handler, policy);
			results.push(result);

			if (
				(result.status === "error" || result.status === "timeout") &&
				policy.failureMode === "fail_closed"
			) {
				throw (
					result.error ??
					new Error(
						`Hook handler "${handler.name}" failed at stage "${event.stage}"`,
					)
				);
			}
		}

		return results;
	}

	private async executeHandler(
		event: HookEventEnvelope,
		handler: HookHandler,
		policy: HookStagePolicy,
	): Promise<HookHandlerResult> {
		const startedAt = Date.now();
		let attempt = 0;
		let lastError: Error | undefined;
		let lastStatus: HookHandlerResult["status"] = "error";

		while (attempt <= policy.retries) {
			attempt += 1;
			try {
				const value = await withTimeout(
					Promise.resolve(handler.handle(event)),
					policy.timeoutMs,
					handler.name,
					event.stage,
				);
				const control = isControl(value) ? value : undefined;
				return {
					handlerName: handler.name,
					stage: event.stage,
					status: "ok",
					attempts: attempt,
					durationMs: Date.now() - startedAt,
					control,
				};
			} catch (error) {
				lastError = asError(error);
				lastStatus = /timed out/i.test(lastError.message) ? "timeout" : "error";
				this.options.onDispatchError?.(lastError, event, handler.name);
				if (attempt <= policy.retries && policy.retryDelayMs > 0) {
					await new Promise((resolve) =>
						setTimeout(resolve, policy.retryDelayMs),
					);
				}
			}
		}

		return {
			handlerName: handler.name,
			stage: event.stage,
			status: lastStatus,
			attempts: attempt,
			durationMs: Date.now() - startedAt,
			error: lastError,
		};
	}

	private mergeControlsFromResults(
		results: HookHandlerResult[],
	): HookControl | undefined {
		let merged: HookControl | undefined;
		for (const result of results) {
			merged = mergeControl(merged, result.control);
		}
		return merged;
	}
}
