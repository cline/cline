import { randomUUID } from "node:crypto";
import {
	type AgentMessage,
	type AgentModel,
	type AgentModelEvent,
	type AgentModelRequest,
	type AgentRuntimeEvent,
	type AgentToolResultPart,
	type AgentUsage,
	mergeModelOptions,
	type ProviderErrorClass,
} from "@cline/shared";

export interface ForkRequest {
	/**
	 * The run the question is about: `snapshot.runId` of a hook. A run that is
	 * no longer the latest ends as `stale_run`. Leave unset to ask about the
	 * latest run, whichever it is.
	 */
	runId?: string;
	/** Appended as one user message after the recorded request and its reply. */
	instruction: string;
	/**
	 * Overrides the turn's own output cap. Room for thinking is added on top:
	 * the turn's fixed budget, or `FORK_THINKING_ALLOWANCE_TOKENS` when the
	 * model thinks adaptively. Leave unset to keep the turn's cap, which keeps
	 * the fork closest to the main chat.
	 */
	maxOutputTokens?: number;
	/** Ends the fork as `aborted`. The next run and shutdown end it too. */
	signal?: AbortSignal;
}

export type ForkUnavailableReason =
	| "no_recorded_request"
	| "stale_run"
	| "no_prompt_cache"
	| "aborted"
	| "provider_error";

export interface ModelAnswer {
	text: string;
	usage: AgentUsage;
	/** Tools the model asked to call. None of them are executed. */
	calledTools: string[];
}

export interface ForkSuccess extends ModelAnswer {
	/** The run whose request was forked. */
	runId: string;
}

export interface ForkUnavailable {
	runId?: string;
	unavailable: ForkUnavailableReason;
	error?: string;
}

export type ForkResult = ForkSuccess | ForkUnavailable;

/**
 * Thinking room for a capped fork of a turn that thinks without a fixed
 * budget. Adaptive thinking spends from the same output cap as the answer, so
 * without it a turn that thinks a little longer than usual ends the fork at
 * the cap before the answer is written.
 */
export const FORK_THINKING_ALLOWANCE_TOKENS = 2_000;

/** What the session knew about the run's model when the run started. */
export interface RunModelFacts {
	supportsPromptCache: boolean;
	/** Whether the turn's requests may think: thinking was not turned off. */
	mayThink: boolean;
	/** Fixed thinking budget the turn's requests carried, if any. */
	thinkingBudgetTokens?: number;
}

interface RecordedModelRequest extends RunModelFacts {
	runId: string;
	model: AgentModel;
	request: Omit<AgentModelRequest, "signal">;
	firstFollowingMessageId?: string;
	/** Run transcript as of the latest message added after the request. */
	transcript: readonly AgentMessage[];
}

const UNANSWERED_TOOL_CALL_OUTPUT =
	"No result: this tool call had not been answered when the question was asked.";

/**
 * The request a fork sends: the recorded request unchanged except for the
 * messages appended after it, a fresh model request id and, only when given,
 * a new output cap.
 * Anything else that differs (tools, system prompt, thinking, tool choice)
 * would miss the provider's prompt cache.
 */
export function buildForkModelRequest(input: {
	recorded: Omit<AgentModelRequest, "signal">;
	followingMessages: readonly AgentMessage[];
	instruction: string;
	maxTokens?: number;
	signal: AbortSignal;
}): AgentModelRequest {
	return {
		...input.recorded,
		messages: [
			...input.recorded.messages,
			...answerOpenToolCalls(input.followingMessages),
			{
				id: `fork_instruction_${randomUUID()}`,
				role: "user",
				content: [{ type: "text", text: input.instruction }],
				createdAt: Date.now(),
			},
		],
		options: mergeModelOptions(input.recorded.options, {
			...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
			metadata: { modelRequestId: `fork_${randomUUID()}` },
		}),
		signal: input.signal,
	};
}

/**
 * Providers reject a transcript where a tool call has no result, so calls
 * without one get an error result: the run was aborted or stopped mid-batch,
 * or it is still working and the tool has not returned.
 */
function answerOpenToolCalls(
	messages: readonly AgentMessage[],
): AgentMessage[] {
	const answered = new Set<string>();
	for (const message of messages) {
		for (const part of message.content) {
			if (part.type === "tool-result") answered.add(part.toolCallId);
		}
	}
	const unanswered: AgentToolResultPart[] = [];
	for (const message of messages) {
		for (const part of message.content) {
			if (
				part.type === "tool-call" &&
				part.execution !== "provider" &&
				!answered.has(part.toolCallId)
			) {
				unanswered.push({
					type: "tool-result",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					output: UNANSWERED_TOOL_CALL_OUTPUT,
					isError: true,
				});
			}
		}
	}
	if (unanswered.length === 0) return [...messages];
	return [
		...messages,
		{
			id: `fork_tool_results_${randomUUID()}`,
			role: "tool",
			content: unanswered,
			createdAt: Date.now(),
		},
	];
}

function addUsage(total: AgentUsage, next: Partial<AgentUsage>): AgentUsage {
	return {
		inputTokens: total.inputTokens + (next.inputTokens ?? 0),
		outputTokens: total.outputTokens + (next.outputTokens ?? 0),
		cacheReadTokens: total.cacheReadTokens + (next.cacheReadTokens ?? 0),
		cacheWriteTokens: total.cacheWriteTokens + (next.cacheWriteTokens ?? 0),
		reasoningTokenCount:
			(total.reasoningTokenCount ?? 0) + (next.reasoningTokenCount ?? 0),
		totalCost: (total.totalCost ?? 0) + (next.totalCost ?? 0),
	};
}

/** A model stream that ended in an error instead of an answer. */
export class ModelAnswerError extends Error {
	constructor(
		message: string,
		readonly errorClass?: ProviderErrorClass,
		readonly retryable?: boolean,
	) {
		super(message);
		this.name = "ModelAnswerError";
	}
}

/** Reads one model stream to its end. Throws `ModelAnswerError` when the stream reports an error. */
export async function readModelAnswer(
	stream: AsyncIterable<AgentModelEvent>,
	signal: AbortSignal,
): Promise<ModelAnswer> {
	let text = "";
	let usage: AgentUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	const calledTools = new Set<string>();
	for await (const event of stream) {
		if (signal.aborted) break;
		if (event.type === "text-delta") text += event.text;
		if (event.type === "tool-call-delta" && event.toolName) {
			calledTools.add(event.toolName);
		}
		if (event.type === "usage") usage = addUsage(usage, event.usage);
		if (event.type === "finish" && event.reason === "error") {
			throw new ModelAnswerError(
				event.error ?? "the model stream failed",
				event.errorClass,
				event.errorRetryable,
			);
		}
	}
	return { text, usage, calledTools: [...calledTools] };
}

/**
 * Keeps the last model request of the session's latest run in memory and
 * runs ephemeral forks of it. A fork calls the model directly: it never goes
 * through the agent loop, so its messages, usage and tool calls never reach
 * the transcript, the session's events or storage.
 */
export class EphemeralForkController {
	private currentRunId: string | undefined;
	private recorded: RecordedModelRequest | undefined;
	private readonly inFlight = new Set<AbortController>();

	/** Forget the previous run's request and abort the forks of it. */
	beginRun(): void {
		for (const fork of this.inFlight) fork.abort();
		this.inFlight.clear();
		this.currentRunId = undefined;
		this.recorded = undefined;
	}

	dispose(): void {
		this.beginRun();
	}

	/** Whether no later run has begun: the run is in progress or was the last to finish. */
	isLatestRun(runId: string): boolean {
		return this.currentRunId === runId;
	}

	/** Wraps the run's model so every request it sends is recorded as sent. */
	recordingModel(model: AgentModel, facts: RunModelFacts): AgentModel {
		return {
			stream: (request) => {
				const runId = this.currentRunId;
				if (runId) {
					const { signal: _signal, ...sent } = request;
					this.recorded = {
						...facts,
						runId,
						model,
						request: sent,
						transcript: [],
					};
				}
				return model.stream(request);
			},
		};
	}

	observe(event: AgentRuntimeEvent): void {
		if (event.type === "run-started") {
			this.currentRunId = event.snapshot.runId;
			return;
		}
		if (event.type !== "message-added" || !this.recorded) return;
		this.recorded.firstFollowingMessageId ??= event.message.id;
		this.recorded.transcript = event.snapshot.messages;
	}

	async fork(request: ForkRequest): Promise<ForkResult> {
		const recorded = this.recorded;
		const unavailable = (
			reason: ForkUnavailableReason,
			error?: string,
		): ForkUnavailable => ({
			runId: request.runId ?? recorded?.runId,
			unavailable: reason,
			...(error ? { error } : {}),
		});
		if (!recorded) return unavailable("no_recorded_request");
		if (request.runId !== undefined && recorded.runId !== request.runId)
			return unavailable("stale_run");
		if (!recorded.supportsPromptCache) return unavailable("no_prompt_cache");

		if (request.signal?.aborted) return unavailable("aborted");

		const controller = new AbortController();
		const abort = () => controller.abort();
		request.signal?.addEventListener("abort", abort, { once: true });
		this.inFlight.add(controller);
		try {
			const answer = await readModelAnswer(
				await recorded.model.stream(
					buildForkModelRequest({
						recorded: recorded.request,
						followingMessages: followingMessagesOf(recorded),
						instruction: request.instruction,
						maxTokens:
							request.maxOutputTokens === undefined
								? undefined
								: request.maxOutputTokens + thinkingRoom(recorded),
						signal: controller.signal,
					}),
				),
				controller.signal,
			);
			if (controller.signal.aborted) return unavailable("aborted");
			return { runId: recorded.runId, ...answer };
		} catch (error) {
			if (controller.signal.aborted) return unavailable("aborted");
			return unavailable(
				"provider_error",
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			request.signal?.removeEventListener("abort", abort);
			this.inFlight.delete(controller);
		}
	}
}

function thinkingRoom(facts: RunModelFacts): number {
	if (!facts.mayThink) return 0;
	return facts.thinkingBudgetTokens ?? FORK_THINKING_ALLOWANCE_TOKENS;
}

function followingMessagesOf(
	recorded: RecordedModelRequest,
): readonly AgentMessage[] {
	if (!recorded.firstFollowingMessageId) return [];
	const start = recorded.transcript.findIndex(
		(message) => message.id === recorded.firstFollowingMessageId,
	);
	return start === -1 ? [] : recorded.transcript.slice(start);
}
