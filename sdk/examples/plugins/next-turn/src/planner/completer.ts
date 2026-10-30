import type * as Core from "@cline/core";
import type { Llms, ProviderSettings } from "@cline/core";
import type { ClientContext } from "@cline/shared";
import type { PlannerInput, ProviderChoice } from "../types";

/**
 * Where the planner meets a model: one tool-less, bounded call on the chat's
 * own provider and model, so nothing new leaves the machine. Ported from
 * #15095's `planner/model/model.ts`, minus the settings override, the
 * first-token meter and the adaptive deadline.
 */

export const PLANNER_MAX_OUTPUT_TOKENS = 400;
export const PLANNER_TEMPERATURE = 0.3;
/** For a model that refuses reasoning off: reasoning tokens count against the output budget, so the retry gets a larger one. */
export const PLANNER_RETRY_REASONING_EFFORT = "low";
export const PLANNER_RETRY_MAX_OUTPUT_TOKENS = 2_000;

export type Completion = {
	text: string;
	usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
};

export type CompleteRequest = {
	input: PlannerInput;
	chat: ProviderChoice;
	sessionId: string;
	client?: ClientContext;
	signal: AbortSignal;
};

/** One tool-less call; null when no provider can be resolved for the chat's provider. */
export type Complete = (request: CompleteRequest) => Promise<Completion | null>;

type CoreModule = typeof Core;
type PlannerRequestContext = Pick<CompleteRequest, "sessionId" | "client">;

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
 * undefined when the provider has no key, no URL, and none of the cloud
 * credentials, local sign-in or keyless endpoint core's readiness check looks
 * for. The planner never borrows another provider.
 *
 * Read-only: the worker shares the host's process id, so a token refresh here
 * would race the host's writes to the same settings file. The chat refreshed
 * the token for the turn that just ended; an expired one fails as auth and
 * the rule suggestions stand.
 */
export function providerResolver(
	core: CoreModule,
	env: NodeJS.ProcessEnv = process.env,
): (
	choice: ProviderChoice,
	requestContext: PlannerRequestContext,
) => Llms.ProviderConfig | undefined {
	const manager = new core.ProviderSettingsManager();
	return (choice, requestContext) => {
		const stored = manager.getProviderSettings(choice.providerId);
		if (!stored) return undefined;
		const config = core.toProviderConfig(stored, { includeKnownModels: false });
		const providerId = config.providerId;
		const apiKey = (
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
		const headers = core.Llms.resolveProviderRequestHeaders({
			providerId,
			sessionId: requestContext.sessionId,
			defaultSource: "cli",
			client: {
				...requestContext.client,
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
			modelId: choice.modelId,
			...(apiKey ? { apiKey, accessToken: apiKey } : {}),
			...(headers ? { headers } : {}),
		};
	};
}

/** Streams one answer's text and the usage the provider reported. */
async function streamCompletion(
	handler: Llms.ApiHandler,
	input: PlannerInput,
): Promise<Completion> {
	let text = "";
	let usage: Completion["usage"];
	const stream: AsyncIterable<Llms.ApiStreamChunk> = handler.createMessage(
		input.system,
		[{ role: "user", content: input.user }],
	);
	for await (const chunk of stream) {
		if (chunk.type === "text") text += chunk.text;
		else if (chunk.type === "usage")
			usage = {
				inputTokens: (usage?.inputTokens ?? 0) + chunk.inputTokens,
				outputTokens: (usage?.outputTokens ?? 0) + chunk.outputTokens,
				...(chunk.totalCost === undefined
					? {}
					: { costUsd: (usage?.costUsd ?? 0) + chunk.totalCost }),
			};
		else if (chunk.type === "done" && !chunk.success)
			throw new Error(chunk.error ?? "the model stream failed");
	}
	return { text, ...(usage ? { usage } : {}) };
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

/**
 * `@cline/core` is a large module, so it is imported by the first call that
 * has a provider to ask: loading the plugin stays inside the sandbox's import
 * budget. The sandbox loader aliases the specifier to the host's runtime.
 */
const loadCore = (): Promise<CoreModule> => import("@cline/core");

export function clineCompleter(
	load: () => Promise<CoreModule> = loadCore,
): Complete {
	let ready:
		| Promise<{
				core: CoreModule;
				resolve: ReturnType<typeof providerResolver>;
		  }>
		| undefined;
	return async ({ input, chat, sessionId, client, signal }) => {
		ready ??= load()
			.then((core) => ({ core, resolve: providerResolver(core) }))
			.catch((error: unknown) => {
				ready = undefined;
				throw error;
			});
		const { core, resolve } = await ready;
		const config = resolve(chat, { sessionId, client });
		if (!config) return null;
		const llms = core.Llms;
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
			return streamCompletion(handler, input);
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
