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
} from "../config";
import { TIMED_OUT, withDeadline } from "../deadline";
import type { Settings } from "../settings/settings";
import { errorMessage } from "../values";
import type { Suggestion } from "./candidates";
import type { PlannerInput } from "./input";
import type { SuggestionKind } from "./kinds";
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

type Completion = {
	text: string;
	costUsd?: number;
	providerId?: string;
	modelId?: string;
};

/**
 * One tool-less call; null when no provider can be resolved. `settings` are
 * the ones the input's sources were allowed under, so the call goes where they
 * allowed it to.
 */
export type Complete = (
	input: PlannerInput,
	signal: AbortSignal,
	settings: Settings,
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

type PoolFailure = "no_provider" | "timeout" | "unparseable" | "error";

type PoolAttempt = Omit<Completion, "text"> &
	({ pool: Suggestion[] } | { reason: PoolFailure; error?: string });

/** Races the call against the deadline; a call that loses is aborted and its late failure ignored. */
export async function generatePool(
	complete: Complete,
	input: PlannerInput,
	kinds: readonly SuggestionKind[],
	settings: Settings,
	timeoutMs: number = PLANNER_TIMEOUT_MS,
): Promise<PoolAttempt> {
	try {
		const answer = await withDeadline(
			(signal) => complete(input, signal, settings),
			timeoutMs,
		);
		if (answer === TIMED_OUT) return { reason: "timeout" };
		if (answer === null) return { reason: "no_provider" };
		const { text, ...meta } = answer;
		const pool = parsePlannerOutput(text, kinds);
		return pool ? { pool, ...meta } : { reason: "unparseable", ...meta };
	} catch (error) {
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
 * Resolves the provider config the planner calls with, its key and request
 * headers resolved the way `local-runtime-bootstrap.ts` resolves a chat's;
 * undefined when the provider is not usable. Under `kind: "chat"` the planner
 * never borrows another provider from `getLastUsedProviderConfig`. One
 * resolver serves every call, so concurrent calls share an OAuth refresh; the
 * settings file is still read on each call.
 */
export function providerResolver(
	core: CoreModule,
	llms: Pick<LlmsModule, "resolveProviderRequestHeaders">,
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
		if (!apiKey && !config.baseUrl) return undefined;
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

/** Streams one answer, summing text and the cost the provider reports. */
export async function streamCompletion(
	handler: ApiHandler,
	input: PlannerInput,
): Promise<Completion> {
	let text = "";
	let costUsd: number | undefined;
	const stream: AsyncIterable<ApiStreamChunk> = handler.createMessage(
		input.system,
		[{ role: "user", content: input.user }],
	);
	for await (const chunk of stream) {
		if (chunk.type === "text") text += chunk.text;
		else if (chunk.type === "usage" && chunk.totalCost !== undefined)
			costUsd = (costUsd ?? 0) + chunk.totalCost;
		else if (chunk.type === "done" && !chunk.success)
			throw new Error(chunk.error ?? "the model stream failed");
	}
	return { text, costUsd };
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
	/** Read on every call, so the request headers name the client viewing the chat now. */
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
	return async (input, signal, settings) => {
		const picked = choice(settings);
		if (!picked.providerId) return null;
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
		const modelKey = `${config.providerId}:${config.modelId ?? ""}`;
		const meta = { providerId: config.providerId, modelId: config.modelId };
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
			return { ...(await streamCompletion(handler, input)), ...meta };
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
