import { isAbortError } from "@ai-sdk/provider-utils";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { type Span, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import type {
	LanguageModelCallEndEvent,
	LanguageModelCallStartEvent,
	ToolSet,
} from "ai";
import {
	isTimeoutReason,
	type StreamAttemptTelemetry,
} from "./stream-error-telemetry";

/** Owns the lifetime of model attempts that end without an AI SDK finish event. */
export class LangfuseStreamTelemetry
	extends LangfuseVercelAiSdkIntegration
	implements StreamAttemptTelemetry
{
	private readonly attempts = new Map<string, Span>();
	private readonly completedAttempts = new Map<
		string,
		LanguageModelCallEndEvent<ToolSet>
	>();
	private startingCallId?: string;

	constructor(tracer: Tracer) {
		super({
			tracer: {
				startSpan: (name, options, context) => {
					const span = tracer.startSpan(name, options, context);
					if (this.startingCallId) this.attempts.set(this.startingCallId, span);
					return span;
				},
				startActiveSpan: tracer.startActiveSpan.bind(tracer),
			},
		});
	}

	override onLanguageModelCallStart(event: LanguageModelCallStartEvent): void {
		// A retry can cancel the failed stream before its finish event is read.
		this.endAttempt(event.callId);
		this.startingCallId = event.callId;
		try {
			super.onLanguageModelCallStart(event);
		} finally {
			this.startingCallId = undefined;
		}
	}

	override async executeLanguageModelCall<T>(params: {
		callId: string;
		execute: () => PromiseLike<T>;
	}): Promise<T> {
		try {
			return await super.executeLanguageModelCall(params);
		} catch (error) {
			// Request-start failures are retried inside the AI SDK, before onError
			// is notified. Export the failed attempt before backoff or recovery.
			this.onLanguageModelCallError({ callId: params.callId, error });
			this.endAttempt(params.callId);
			throw error;
		}
	}

	override onLanguageModelCallEnd(
		event: LanguageModelCallEndEvent<ToolSet>,
	): void {
		// A failed finish can be read ahead of the application's error callback.
		// Defer that completion so the original error can still mark the span.
		// Successful calls keep their original lifetime and latency measurement.
		this.completedAttempts.set(event.callId, event);
		if (event.finishReason !== "error") this.endAttempt(event.callId);
	}

	private endAttempt(callId: string): void {
		const completed = this.completedAttempts.get(callId);
		if (completed) super.onLanguageModelCallEnd(completed);
		else this.attempts.get(callId)?.end();
		this.completedAttempts.delete(callId);
		this.attempts.delete(callId);
	}

	override onStepEnd(
		event: Parameters<LangfuseVercelAiSdkIntegration["onStepEnd"]>[0],
	): void {
		this.endAttempt(event.callId);
		super.onStepEnd(event);
	}

	onLanguageModelCallError({
		callId,
		error,
	}: {
		callId: string;
		error: unknown;
	}): void {
		// Intentional cancellation is not a provider failure; timeouts still are.
		if (isAbortError(error) && !isTimeoutReason(error)) return;
		const span = this.attempts.get(callId);
		if (!span) return;
		const message =
			error instanceof Error
				? error.message
				: typeof error === "object" &&
						error !== null &&
						"message" in error &&
						typeof error.message === "string"
					? error.message
					: "Provider stream failed";
		span.recordException(error instanceof Error ? error : { message });
		span.setStatus({ code: SpanStatusCode.ERROR, message });
	}

	override onError(error: unknown): void {
		if (
			typeof error === "object" &&
			error !== null &&
			"callId" in error &&
			typeof error.callId === "string"
		) {
			const cause = "error" in error ? error.error : error;
			if (isAbortError(cause) && !isTimeoutReason(cause)) {
				this.endAttempt(error.callId);
				return;
			}
			this.onLanguageModelCallError({
				callId: error.callId,
				error: cause,
			});
			this.endAttempt(error.callId);
		}
		super.onError(error);
	}

	override onEnd(
		event: Parameters<LangfuseVercelAiSdkIntegration["onEnd"]>[0],
	): void {
		this.endAttempt(event.callId);
		super.onEnd(event);
	}

	override onAbort(
		event: Parameters<LangfuseVercelAiSdkIntegration["onAbort"]>[0],
	): void {
		this.endAttempt(event.callId);
		super.onAbort(event);
	}
}
