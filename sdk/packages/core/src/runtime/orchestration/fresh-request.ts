import { randomUUID } from "node:crypto";
import { classifyProviderError, isRetryableProviderError } from "@cline/llms";
import {
	type AgentConfig,
	type BasicLogger,
	type ITelemetryService,
	mergeModelOptions,
} from "@cline/shared";
import { createAgentModelFromConfig } from "../../services/llms/handler-factory";
import { buildModelOptions } from "../config/agent-runtime-config-builder";
import {
	FORK_THINKING_ALLOWANCE_TOKENS,
	type ModelAnswer,
	ModelAnswerError,
	readModelAnswer,
} from "./ephemeral-fork";

export const FRESH_REQUEST_TEMPERATURE = 0.3;
export const FRESH_REQUEST_RETRY_REASONING_EFFORT = "low";

export interface FreshRequest {
	system?: string;
	prompt: string;
	maxOutputTokens: number;
	signal: AbortSignal;
}

export interface FreshRequestDeps {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	createModel?: typeof createAgentModelFromConfig;
}

type Bounds = Pick<
	AgentConfig,
	"thinking" | "reasoningEffort" | "thinkingBudgetTokens" | "maxTokensPerTurn"
>;

/** An auth failure or a transient one fails the same way with reasoning on, so only other errors are worth the retry. */
function mayBeReasoningRefusal(error: unknown): boolean {
	const typed = error instanceof ModelAnswerError ? error : undefined;
	const cause = typed ? typed.message : error;
	return (
		(typed?.errorClass ?? classifyProviderError(cause)) !== "auth" &&
		!(typed?.retryable ?? isRetryableProviderError(cause))
	);
}

/** Models whose low-reasoning retry answered after reasoning-off failed; later requests skip the doomed first try. */
const reasoningRequired = new Set<string>();

/**
 * Sends one tool-less request of a system prompt and one user message on the
 * session's own provider and model, so nothing new leaves the machine. It
 * shares nothing with the chat's transcript and is not cached by it.
 *
 * Reasoning is off so the answer is fast and its length is the whole output.
 * A model that refuses reasoning off is asked again with low reasoning, and
 * a larger cap because reasoning spends from the same output budget.
 */
export async function sendFreshRequest(
	config: AgentConfig,
	request: FreshRequest,
	deps: FreshRequestDeps = {},
): Promise<ModelAnswer> {
	const createModel = deps.createModel ?? createAgentModelFromConfig;
	const ask = async (bounds: Bounds): Promise<ModelAnswer> => {
		const bounded: AgentConfig = {
			...config,
			...bounds,
			temperature: FRESH_REQUEST_TEMPERATURE,
		};
		// The gateway reads reasoning from each request's options, the way the
		// agent loop sends it; a host-registered handler reads it from the
		// config it is built with. Both get the bounds.
		const model = createModel(bounded, deps.logger, deps.telemetry);
		return readModelAnswer(
			await model.stream({
				systemPrompt: request.system,
				messages: [
					{
						id: `aside_prompt_${randomUUID()}`,
						role: "user",
						content: [{ type: "text", text: request.prompt }],
						createdAt: Date.now(),
					},
				],
				tools: [],
				signal: request.signal,
				options: mergeModelOptions(buildModelOptions(bounded), {
					metadata: { modelRequestId: `aside_${randomUUID()}` },
				}),
			}),
			request.signal,
		);
	};
	const reasoningOff: Bounds = {
		thinking: false,
		reasoningEffort: undefined,
		thinkingBudgetTokens: undefined,
		maxTokensPerTurn: request.maxOutputTokens,
	};
	const lowReasoning: Bounds = {
		thinking: true,
		reasoningEffort: FRESH_REQUEST_RETRY_REASONING_EFFORT,
		thinkingBudgetTokens: undefined,
		maxTokensPerTurn: request.maxOutputTokens + FORK_THINKING_ALLOWANCE_TOKENS,
	};
	const modelKey = `${config.providerId}:${config.modelId}`;
	if (reasoningRequired.has(modelKey)) return ask(lowReasoning);
	try {
		return await ask(reasoningOff);
	} catch (error) {
		if (request.signal.aborted || !mayBeReasoningRefusal(error)) throw error;
		const answer = await ask(lowReasoning);
		reasoningRequired.add(modelKey);
		return answer;
	}
}
