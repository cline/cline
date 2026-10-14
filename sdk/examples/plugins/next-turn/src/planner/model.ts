import type { ApiHandler, ApiStreamChunk, ProviderConfig } from "@cline/llms";
import {
	PLANNER_MAX_OUTPUT_TOKENS,
	PLANNER_RETRY_MAX_OUTPUT_TOKENS,
	PLANNER_RETRY_REASONING_EFFORT,
	PLANNER_TEMPERATURE,
	PLANNER_TIMEOUT_MS,
	POOL_CACHE_LIMIT,
} from "../config";
import type { Settings } from "../settings/settings";
import type { Suggestion, SuggestionKind } from "./candidates";
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

export type Completion = {
	text: string;
	costUsd?: number;
	providerId?: string;
	modelId?: string;
};

/** One tool-less call; null when no provider can be resolved. Tests supply a fake. */
export type Complete = (
	input: PlannerInput,
	signal: AbortSignal,
) => Promise<Completion | null>;

/** Pools by turn position, oldest dropped first: a pool is only worth the turn it was written for. */
export class PoolCache {
	private readonly pools = new Map<string, readonly Suggestion[]>();

	constructor(private readonly limit: number = POOL_CACHE_LIMIT) {}

	get(key: string): readonly Suggestion[] | undefined {
		return this.pools.get(key);
	}

	set(key: string, pool: readonly Suggestion[]): void {
		this.pools.delete(key);
		this.pools.set(key, pool);
		for (const oldest of this.pools.keys()) {
			if (this.pools.size <= this.limit) break;
			this.pools.delete(oldest);
		}
	}
}

export type PoolFailure = "no_provider" | "timeout" | "unparseable" | "error";

export type PoolAttempt =
	| {
			pool: Suggestion[];
			costUsd?: number;
			providerId?: string;
			modelId?: string;
	  }
	| {
			reason: PoolFailure;
			error?: string;
			costUsd?: number;
			providerId?: string;
			modelId?: string;
	  };

/** Races the call against the deadline; a call that loses is aborted and its late failure ignored. */
export async function generatePool(
	complete: Complete,
	input: PlannerInput,
	kinds: readonly SuggestionKind[],
	timeoutMs: number = PLANNER_TIMEOUT_MS,
): Promise<PoolAttempt> {
	const controller = new AbortController();
	const timedOut = new Promise<"timeout">((resolve) => {
		controller.signal.addEventListener("abort", () => resolve("timeout"), {
			once: true,
		});
	});
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const pending = complete(input, controller.signal);
	pending.catch(() => undefined);
	try {
		const answer = await Promise.race([pending, timedOut]);
		if (answer === "timeout") return { reason: "timeout" };
		if (answer === null) return { reason: "no_provider" };
		const meta = {
			...(answer.costUsd === undefined ? {} : { costUsd: answer.costUsd }),
			...(answer.providerId ? { providerId: answer.providerId } : {}),
			...(answer.modelId ? { modelId: answer.modelId } : {}),
		};
		const pool = parsePlannerOutput(answer.text, kinds);
		return pool ? { pool, ...meta } : { reason: "unparseable", ...meta };
	} catch (error) {
		return {
			reason: "error",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

/** Which provider and model the planner asks; an absent `providerId` means no provider is known for this chat yet. */
export type ProviderChoice = { providerId?: string; modelId?: string };

export type PlannerRequestContext = {
	sessionId?: string;
	client?: {
		name?: string;
		version?: string;
		platform?: string;
		platformVersion?: string;
		isMultiRoot?: boolean;
	};
};

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
 * The provider config the planner calls with, with its key and request headers
 * resolved the way `local-runtime-bootstrap.ts` resolves a chat's; undefined
 * when none is usable or when no provider id is known (under `kind: "chat"`,
 * the planner never borrows another provider from `getLastUsedProviderConfig`).
 */
export async function resolveProviderConfig(
	core: CoreModule,
	choice: ProviderChoice,
	llms?: Pick<LlmsModule, "resolveProviderRequestHeaders">,
	requestContext?: PlannerRequestContext,
): Promise<ProviderConfig | undefined> {
	if (!choice.providerId) return undefined;
	const manager = new core.ProviderSettingsManager();
	const config = manager.getProviderConfig(choice.providerId, {
		includeKnownModels: false,
	});
	if (!config) return undefined;
	const providerId = config.providerId;
	const stored =
		typeof manager.getProviderSettings === "function"
			? manager.getProviderSettings(providerId)
			: undefined;
	const oauth = await new core.RuntimeOAuthTokenManager({
		providerSettingsManager: manager,
	}).resolveProviderApiKey({ providerId });
	const apiKey = (
		oauth?.apiKey ||
		core.resolveProviderApiKeyFromSettings(manager, providerId) ||
		config.apiKey ||
		""
	).trim();
	if (!apiKey && !config.baseUrl) return undefined;
	const coreVersion =
		typeof core.CORE_BUILD_VERSION === "string" && core.CORE_BUILD_VERSION
			? core.CORE_BUILD_VERSION
			: "unknown";
	const headers = llms?.resolveProviderRequestHeaders
		? llms.resolveProviderRequestHeaders({
				providerId,
				sessionId: requestContext?.sessionId,
				defaultSource: "cli",
				client: {
					name: requestContext?.client?.name,
					version: requestContext?.client?.version,
					versionHeaderFallback: config.headers?.["X-CLIENT-VERSION"],
					platform: requestContext?.client?.platform,
					platformVersion: requestContext?.client?.platformVersion,
					isMultiRoot: requestContext?.client?.isMultiRoot,
				},
				coreVersion,
				openAiCodex: {
					accountId: config.accountId ?? stored?.auth?.accountId,
					accessToken: apiKey || stored?.auth?.accessToken || stored?.apiKey,
				},
				headers: {
					stored: stored?.headers,
					config: config.headers,
				},
			})
		: config.headers;
	return {
		...config,
		...(choice.modelId ? { modelId: choice.modelId } : {}),
		...(apiKey ? { apiKey, accessToken: apiKey } : {}),
		...(headers ? { headers } : {}),
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
	return { text, ...(costUsd === undefined ? {} : { costUsd }) };
}

/** Models whose low-reasoning retry answered after reasoning-off failed; later calls skip the doomed first try. */
const reasoningRequired = new Set<string>();

/**
 * The real completer: `@cline/core` and `@cline/llms` are imported on the
 * first call, so loading the plugin stays inside the sandbox's import budget.
 */
export function clineCompleter(
	choice: () => ProviderChoice,
	load: () => Promise<{ core: CoreModule; llms: LlmsModule }> = async () => ({
		core: await import("@cline/core"),
		llms: await import("@cline/llms"),
	}),
	requestContext?: PlannerRequestContext,
): Complete {
	return async (input, signal) => {
		const { core, llms } = await load();
		const config = await resolveProviderConfig(
			core,
			choice(),
			llms,
			requestContext,
		);
		if (!config) return null;
		const modelKey = `${config.providerId}:${config.modelId ?? ""}`;
		const meta = {
			providerId: config.providerId,
			...(config.modelId ? { modelId: config.modelId } : {}),
		};
		const call = async (reasoningOff: boolean): Promise<Completion> => {
			const handler = await llms.createHandlerAsync({
				...config,
				temperature: PLANNER_TEMPERATURE,
				...(reasoningOff
					? {
							maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
							reasoningEffort: undefined,
							thinkingBudgetTokens: undefined,
							thinking: false,
						}
					: {
							maxOutputTokens: PLANNER_RETRY_MAX_OUTPUT_TOKENS,
							reasoningEffort: PLANNER_RETRY_REASONING_EFFORT,
							thinking: true,
						}),
				abortSignal: signal,
			});
			handler.setAbortSignal?.(signal);
			const result = await streamCompletion(handler, input);
			return { ...result, ...meta };
		};
		if (reasoningRequired.has(modelKey)) return call(false);
		try {
			return await call(true);
		} catch (error) {
			if (signal.aborted) throw error;
			const answer = await call(false);
			reasoningRequired.add(modelKey);
			return answer;
		}
	};
}
