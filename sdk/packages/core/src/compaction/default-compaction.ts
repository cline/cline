/**
 * Default core-managed auto-compaction.
 *
 * Core supports two fallback strategies:
 *
 * - `agentic`: summarize older history with a model, then replace that span
 *   with a synthetic summary message plus the recent preserved tail.
 * - `basic`: shrink history locally without calling a model by stripping old
 *   assistant/tool-heavy content first and keeping the most important user
 *   messages when possible.
 *
 * Both strategies are triggered by the agent once prompt/input usage crosses
 * the configured threshold. Extensions still take precedence through
 * `onContextLimitReached`; this module only provides the default core fallback.
 */
import type { AgentCompactionConfig } from "@clinebot/agents";
import type * as LlmsProviders from "@clinebot/llms";
import type { CoreSessionConfig } from "../types/config";
import { runAgenticCompaction } from "./agentic";
import { runBasicCompaction } from "./basic";
import {
	createTokenEstimator,
	DEFAULT_PRESERVE_RECENT_TOKENS,
	DEFAULT_RESERVE_TOKENS,
} from "./shared";

/**
 * Builds the default agent compaction config for core sessions.
 *
 * - `agentic` uses an LLM summarizer and keeps a synthetic summary message.
 * - `basic` never calls a model; it strips or truncates older history until the
 *   prompt budget fits while trying to preserve the first user message and the
 *   newest user/assistant messages.
 */
export function createDefaultAgentCompaction(
	config: Pick<
		CoreSessionConfig,
		"providerConfig" | "providerId" | "modelId" | "compaction" | "logger"
	>,
): AgentCompactionConfig | undefined {
	const userCompaction = config.compaction;
	if (userCompaction?.enabled === false) {
		return {
			...userCompaction,
			enabled: false,
		};
	}

	const providerConfig =
		config.providerConfig ??
		({
			providerId: config.providerId,
			modelId: config.modelId,
		} as LlmsProviders.ProviderConfig);
	const estimateMessageTokens = createTokenEstimator();
	const strategy = userCompaction?.strategy ?? "agentic";

	return {
		enabled: userCompaction?.enabled ?? true,
		strategy,
		thresholdRatio: userCompaction?.thresholdRatio,
		reserveTokens: userCompaction?.reserveTokens ?? DEFAULT_RESERVE_TOKENS,
		preserveRecentTokens:
			userCompaction?.preserveRecentTokens ?? DEFAULT_PRESERVE_RECENT_TOKENS,
		contextWindowTokens: userCompaction?.contextWindowTokens,
		summarizer: userCompaction?.summarizer,
		compact:
			userCompaction?.compact ??
			(async (context) => {
				if (strategy === "basic") {
					return runBasicCompaction({
						context,
						estimateMessageTokens,
						logger: config.logger,
					});
				}
				return runAgenticCompaction({
					context,
					providerConfig,
					summarizer: userCompaction?.summarizer,
					preserveRecentTokens:
						userCompaction?.preserveRecentTokens ??
						DEFAULT_PRESERVE_RECENT_TOKENS,
					estimateMessageTokens,
					logger: config.logger,
				});
			}),
	};
}
