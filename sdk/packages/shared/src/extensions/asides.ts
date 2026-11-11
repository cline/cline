/**
 * An aside is one model call a plugin makes about a chat. Its question and its
 * answer never enter the chat: nothing is added to the transcript, no tool
 * runs, and the session's events and storage do not see it.
 */

/**
 * What the model reads before the question.
 *
 * `chat` sends the last model request of the run again, with the run's reply
 * and the question appended. The provider's prompt cache serves everything but
 * that tail, so the model sees the whole conversation for a fraction of its
 * price. `none` sends only `system` and `prompt`: a small fresh request for a
 * question that needs no conversation, or for a chat whose model has no cache.
 */
export type AsideContext = "chat" | "none";

export interface AsideRequest {
	/**
	 * The run the question is about. A hook passes its `snapshot.runId`, so a
	 * question about a run the chat has moved past is skipped as `stale_run`.
	 * Leave unset to ask about the latest run, whichever it is.
	 */
	runId?: string;
	/** Defaults to `chat`. */
	context?: AsideContext;
	/** The question, sent as one user message. */
	prompt: string;
	/** `none` only: the system prompt of the fresh request. A `chat` aside keeps the chat's own. */
	system?: string;
	/** Cap on the answer. Thinking room is added on top for a model that thinks. */
	maxOutputTokens?: number;
	/** How long the answer may take before the aside ends as `timeout`. */
	timeoutMs?: number;
}

export interface AsideUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	costUsd?: number;
}

export interface AsideAnswer {
	status: "ok";
	text: string;
	/** `replay` read the chat through the prompt cache; `fresh` sent a new request. */
	transport: "replay" | "fresh";
	usage: AsideUsage;
	/** Tools the model asked for instead of, or besides, answering. None of them ran. */
	calledTools: string[];
}

/**
 * Why no request was sent:
 * - `disabled`: asides are turned off in settings.
 * - `budget`: the plugin used this chat's hourly allowance.
 * - `unsupported`: the host cannot answer asides for this session.
 * - `no_recorded_request`: `chat` only: the chat has made no model request to
 *   replay.
 * - `stale_run`: `runId` was given and is not the chat's latest run.
 * - `no_prompt_cache`: `chat` only: the chat's model has no prompt cache, so a
 *   replay would pay full price for the whole conversation.
 */
export type AsideSkipReason =
	| "disabled"
	| "budget"
	| "unsupported"
	| "no_recorded_request"
	| "stale_run"
	| "no_prompt_cache";

export interface AsideSkipped {
	status: "skipped";
	reason: AsideSkipReason;
}

/**
 * The request was sent and did not produce an answer. `superseded` means the
 * chat moved on: a new run began or the session ended.
 */
export interface AsideFailed {
	status: "superseded" | "timeout" | "error";
	error?: string;
}

export type AsideResult = AsideAnswer | AsideSkipped | AsideFailed;

export interface PluginAsides {
	/** Never rejects: every way an aside can end is an `AsideResult`. */
	ask(request: AsideRequest): Promise<AsideResult>;
}
