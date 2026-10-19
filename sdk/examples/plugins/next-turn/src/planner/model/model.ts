import type { ProviderSettings } from "@cline/core";
import type {
	ApiHandler,
	ApiStreamChunk,
	ProviderConfig,
	ResolveProviderRequestHeadersInput,
} from "@cline/llms";
import {
	PLANNER_MAX_OUTPUT_TOKENS,
	PLANNER_RETRY_MAX_OUTPUT_TOKENS,
	PLANNER_RETRY_REASONING_EFFORT,
	PLANNER_TEMPERATURE,
	PLANNER_TIMEOUT_MS,
	POOL_CACHE_LIMIT,
} from "../../config";
import { TIMED_OUT, withDeadline } from "../../deadline";
import type { Settings } from "../../settings/settings";
import { errorMessage } from "../../values";
import type { Suggestion } from "../candidates";
import type { SuggestionKind } from "../kinds";
import type { PlannerInput } from "./input";
import { parsePlannerOutput } from "./output";

/**
 * Where the planner meets a model. One tool-less, bounded call per turn
 * position writes a pool; Skip walks the pool, and only a used-up pool calls
 * the model again. Anything that goes wrong answers with the rules instead.
 *
 * The provider is the person's own: by default the
 * chat's provider and model, so nothing new leaves the machine; or the one the
 * settings name. A provider that signs in with OAuth is refreshed the way a
 * chat refreshes it. The key never leaves this module.
 */

/** Token counts the provider reported for one call, summed over the usage chunks of every attempt. */
export type CallUsage = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/**
	 * Thinking tokens, only when the provider counts them apart; `outputTokens`
	 * then leaves them out, so the billed output is the two summed. A provider
	 * that does not count them apart keeps them in `outputTokens`.
	 */
	reasoningTokens?: number;
};

/** What one planner call had measured when the planner stopped waiting for it. */
type CallReading = ProviderChoice & {
	/** From asking to the answer, failure, deadline or abort, a low-reasoning retry included. */
	totalMs: number;
	/**
	 * From the first request to the provider to the first text or reasoning
	 * chunk of either attempt, so loading Cline and resolving the key stay out.
	 */
	firstTokenMs?: number;
	usage?: CallUsage;
	costUsd?: number;
};

/**
 * Measures one planner call as its chunks arrive. The caller holds it, so what
 * the provider reported survives a failed stream, a retry, the deadline and a
 * stale abort; whatever an abandoned call reports after the reading is not
 * counted.
 */
export class CallMeter {
	private readonly startedAt: number;
	private firstRequestAt: number | undefined;
	private firstTokenAt: number | undefined;
	private usage: CallUsage | undefined;
	private costUsd: number | undefined;
	private provider: ProviderChoice = {};

	constructor(private readonly now: () => number = Date.now) {
		this.startedAt = now();
		let arm!: () => void;
		this.armed = new Promise((resolve) => {
			arm = resolve;
		});
		this.arm = arm;
	}

	/**
	 * Resolves when the request reaches the provider. The deadline starts
	 * there, so loading Cline and resolving the key do not eat the call's
	 * budget; the budget still caps a setup that never finishes.
	 */
	readonly armed: Promise<void>;
	private readonly arm: () => void;

	asking(provider: ProviderChoice): void {
		this.provider = provider;
	}

	sending(): void {
		this.firstRequestAt ??= this.now();
		this.arm();
	}

	note(chunk: ApiStreamChunk): void {
		if (
			this.firstTokenAt === undefined &&
			(chunk.type === "text" || chunk.type === "reasoning")
		)
			this.firstTokenAt = this.now();
		if (chunk.type !== "usage") return;
		this.usage = addUsage(this.usage, chunk);
		if (chunk.totalCost !== undefined)
			this.costUsd = (this.costUsd ?? 0) + chunk.totalCost;
	}

	read(): CallReading {
		return {
			...this.provider,
			totalMs: this.now() - this.startedAt,
			firstTokenMs:
				this.firstTokenAt === undefined || this.firstRequestAt === undefined
					? undefined
					: this.firstTokenAt - this.firstRequestAt,
			usage: this.usage,
			costUsd: this.costUsd,
		};
	}
}

type Completion = { text: string };

/**
 * One tool-less call; null when no provider can be resolved. `settings` are
 * the ones the input's sources were allowed under, so the call goes where they
 * allowed it to. What the call measures goes on `meter`, not in its answer.
 */
export type Complete = (
	input: PlannerInput,
	signal: AbortSignal,
	settings: Settings,
	meter: CallMeter,
) => Promise<Completion | null>;

/** Pools by turn position, oldest dropped first: a pool is only worth the turn it was written for. */
export class PoolCache {
	private readonly pools = new Map<string, readonly Suggestion[]>();

	get(key: string): readonly Suggestion[] | undefined {
		return this.pools.get(key);
	}

	set(key: string, pool: readonly Suggestion[]): void {
		this.pools.delete(key);
		this.pools.set(key, pool);
		for (const oldest of this.pools.keys()) {
			if (this.pools.size <= POOL_CACHE_LIMIT) break;
			this.pools.delete(oldest);
		}
	}
}

export type PoolFailure =
	| "no_provider"
	| "timeout"
	| "aborted"
	| "unparseable"
	| "error";

type PoolOutcome =
	| { pool: Suggestion[] }
	| { reason: PoolFailure; error?: string };

/**
 * Races the call against the deadline; a call that loses is aborted and its
 * late failure ignored. `stale` aborts it too, once nobody will see its answer.
 * Whatever the outcome, it carries what the call had measured by then.
 */
export async function generatePool(
	complete: Complete,
	input: PlannerInput,
	kinds: readonly SuggestionKind[],
	settings: Settings,
	timeoutMs: number = PLANNER_TIMEOUT_MS,
	stale?: AbortSignal,
): Promise<PoolOutcome & CallReading> {
	const meter = new CallMeter();
	const outcome = await poolOutcome(
		(deadline) =>
			complete(
				input,
				stale ? AbortSignal.any([deadline, stale]) : deadline,
				settings,
				meter,
			),
		kinds,
		timeoutMs,
		stale,
		meter.armed,
	);
	return { ...outcome, ...meter.read() };
}

async function poolOutcome(
	ask: (deadline: AbortSignal) => Promise<Completion | null>,
	kinds: readonly SuggestionKind[],
	timeoutMs: number,
	stale: AbortSignal | undefined,
	armed: Promise<void>,
): Promise<PoolOutcome> {
	try {
		const answer = await withDeadline(ask, timeoutMs, armed);
		if (stale?.aborted) return { reason: "aborted" };
		if (answer === TIMED_OUT) return { reason: "timeout" };
		if (answer === null) return { reason: "no_provider" };
		const pool = parsePlannerOutput(answer.text, kinds);
		return pool ? { pool } : { reason: "unparseable" };
	} catch (error) {
		if (stale?.aborted) return { reason: "aborted" };
		return { reason: "error", error: errorMessage(error) };
	}
}

/** Which provider and model the planner asks; an absent `providerId` means no provider is known for this chat yet. */
type ProviderChoice = { providerId?: string; modelId?: string };

type PlannerRequestContext = Pick<
	ResolveProviderRequestHeadersInput,
	"sessionId" | "client"
>;

/** The settings' choice, else the chat's own provider and model. */
export function plannerProvider(
	settings: Settings,
	chat?: { providerId: string; modelId: string },
): ProviderChoice {
	const model = settings.planner.model;
	if (model.kind === "model")
		return { providerId: model.providerId, modelId: model.modelId };
	return chat ? { providerId: chat.providerId, modelId: chat.modelId } : {};
}

type CoreModule = typeof import("@cline/core");
type LlmsModule = typeof import("@cline/llms");

/**
 * A Bedrock entry as llms signs it in, for core's readiness check: one that
 * names no authentication uses the AWS default credential chain, as `iam`
 * does, and the region and bearer token may come from the environment.
 */
function asBedrockSignsIn(
	stored: ProviderSettings,
	env: NodeJS.ProcessEnv,
): ProviderSettings {
	return {
		...stored,
		apiKey: stored.apiKey || env.AWS_BEARER_TOKEN_BEDROCK,
		aws: {
			...stored.aws,
			authentication: stored.aws?.authentication ?? "iam",
			region: stored.aws?.region || stored.region || env.AWS_REGION,
		},
	};
}

/**
 * Resolves the provider config the planner calls with, its key and request
 * headers resolved the way `local-runtime-bootstrap.ts` resolves a chat's;
 * undefined when it has no key, no URL, and none of the cloud credentials,
 * local sign-in or keyless endpoint core's readiness check looks for. Under
 * `kind: "chat"` the planner never borrows another provider from
 * `getLastUsedProviderConfig`. One resolver serves every call, so concurrent
 * calls share an OAuth refresh; the settings file is still read on each call.
 */
export function providerResolver(
	core: CoreModule,
	llms: Pick<LlmsModule, "resolveProviderRequestHeaders">,
	env: NodeJS.ProcessEnv = process.env,
): (
	choice: ProviderChoice & { providerId: string },
	requestContext?: PlannerRequestContext,
) => Promise<ProviderConfig | undefined> {
	const manager = new core.ProviderSettingsManager();
	const oauth = new core.RuntimeOAuthTokenManager({
		providerSettingsManager: manager,
	});
	return async (choice, requestContext) => {
		const stored = manager.getProviderSettings(choice.providerId);
		if (!stored) return undefined;
		const config = core.toProviderConfig(stored, { includeKnownModels: false });
		const providerId = config.providerId;
		const resolved = await oauth.resolveProviderApiKey({ providerId });
		const apiKey = (
			resolved?.apiKey ||
			core.resolveProviderApiKeyFromSettings(manager, providerId) ||
			config.apiKey ||
			""
		).trim();
		if (
			!apiKey &&
			!config.baseUrl &&
			!core.isProviderSettingsUsable(
				providerId,
				providerId === "bedrock" ? asBedrockSignsIn(stored, env) : stored,
				config,
			)
		)
			return undefined;
		const headers = llms.resolveProviderRequestHeaders({
			providerId,
			sessionId: requestContext?.sessionId,
			defaultSource: "cli",
			client: {
				...requestContext?.client,
				versionHeaderFallback: config.headers?.["X-CLIENT-VERSION"],
			},
			coreVersion: core.CORE_BUILD_VERSION || "unknown",
			openAiCodex: {
				accountId: config.accountId ?? stored.auth?.accountId,
				accessToken: apiKey || stored.auth?.accessToken || stored.apiKey,
			},
			headers: { stored: stored.headers, config: config.headers },
		});
		return {
			...config,
			...(choice.modelId ? { modelId: choice.modelId } : {}),
			...(apiKey ? { apiKey, accessToken: apiKey } : {}),
			...(headers ? { headers } : {}),
		};
	};
}

function addUsage(
	total: CallUsage | undefined,
	chunk: Extract<ApiStreamChunk, { type: "usage" }>,
): CallUsage {
	const reasoningTokens =
		chunk.thoughtsTokenCount === undefined
			? total?.reasoningTokens
			: (total?.reasoningTokens ?? 0) + chunk.thoughtsTokenCount;
	return {
		inputTokens: (total?.inputTokens ?? 0) + chunk.inputTokens,
		outputTokens: (total?.outputTokens ?? 0) + chunk.outputTokens,
		cacheReadTokens:
			(total?.cacheReadTokens ?? 0) + (chunk.cacheReadTokens ?? 0),
		cacheWriteTokens:
			(total?.cacheWriteTokens ?? 0) + (chunk.cacheWriteTokens ?? 0),
		...(reasoningTokens === undefined ? {} : { reasoningTokens }),
	};
}

/** Streams one answer's text, noting the request and each chunk on the call's meter as they happen. */
export async function streamCompletion(
	handler: ApiHandler,
	input: PlannerInput,
	meter: CallMeter,
): Promise<string> {
	let text = "";
	meter.sending();
	const stream: AsyncIterable<ApiStreamChunk> = handler.createMessage(
		input.system,
		[{ role: "user", content: input.user }],
	);
	for await (const chunk of stream) {
		meter.note(chunk);
		if (chunk.type === "text") text += chunk.text;
		else if (chunk.type === "done" && !chunk.success)
			throw new Error(chunk.error ?? "the model stream failed");
	}
	return text;
}

/** The first call's bounds: reasoning off, so the answer fits the planner's deadline. */
const REASONING_OFF = {
	maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
	reasoningEffort: undefined,
	thinkingBudgetTokens: undefined,
	thinking: false,
} as const;

/** The retry's bounds, for a model that refuses reasoning off. */
const LOW_REASONING = {
	maxOutputTokens: PLANNER_RETRY_MAX_OUTPUT_TOKENS,
	reasoningEffort: PLANNER_RETRY_REASONING_EFFORT,
	thinking: true,
} as const;

/** Models whose low-reasoning retry answered after reasoning-off failed; later calls skip the doomed first try. */
const reasoningRequired = new Set<string>();

type CompleterOptions = {
	choice: (settings: Settings) => ProviderChoice;
	/** Read on every call: the session and client the request headers name. */
	requestContext?: () => PlannerRequestContext;
	load?: () => Promise<{ core: CoreModule; llms: LlmsModule }>;
};

const loadCline = async () => ({
	core: await import("@cline/core"),
	llms: await import("@cline/llms"),
});

/**
 * The real completer: `@cline/core` and `@cline/llms` are imported on the
 * first call that has a provider to ask, so loading the plugin stays inside
 * the sandbox's import budget.
 */
export function clineCompleter({
	choice,
	requestContext,
	load = loadCline,
}: CompleterOptions): Complete {
	let ready:
		| Promise<{
				llms: LlmsModule;
				resolve: ReturnType<typeof providerResolver>;
		  }>
		| undefined;
	return async (input, signal, settings, meter) => {
		const picked = choice(settings);
		if (!picked.providerId) return null;
		meter.asking(picked);
		ready ??= load()
			.then(({ core, llms }) => ({
				llms,
				resolve: providerResolver(core, llms),
			}))
			.catch((error: unknown) => {
				ready = undefined;
				throw error;
			});
		const { llms, resolve } = await ready;
		const config = await resolve(
			{ ...picked, providerId: picked.providerId },
			requestContext?.(),
		);
		if (!config) return null;
		meter.asking({ providerId: config.providerId, modelId: config.modelId });
		const modelKey = `${config.providerId}:${config.modelId ?? ""}`;
		const call = async (
			bounds: typeof REASONING_OFF | typeof LOW_REASONING,
		): Promise<Completion> => {
			const handler = await llms.createHandlerAsync({
				...config,
				temperature: PLANNER_TEMPERATURE,
				...bounds,
				abortSignal: signal,
			});
			handler.setAbortSignal?.(signal);
			return { text: await streamCompletion(handler, input, meter) };
		};
		if (reasoningRequired.has(modelKey)) return call(LOW_REASONING);
		try {
			return await call(REASONING_OFF);
		} catch (error) {
			if (
				signal.aborted ||
				llms.classifyProviderError(error) === "auth" ||
				llms.isRetryableProviderError(error)
			)
				throw error;
			const answer = await call(LOW_REASONING);
			reasoningRequired.add(modelKey);
			return answer;
		}
	};
}
