import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { type Span, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import type {
	LanguageModelCallEndEvent,
	LanguageModelCallStartEvent,
	ToolSet,
} from "ai";
import type { StreamAttemptTelemetry } from "./stream-error-telemetry";

/** Owns the lifetime of model attempts that end without an AI SDK finish event. */
export class LangfuseStreamTelemetry
	extends LangfuseVercelAiSdkIntegration
	implements StreamAttemptTelemetry
{
	private readonly attempts = new Map<string, Span>();
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
		this.attempts.get(event.callId)?.end();
		this.attempts.delete(event.callId);
		this.startingCallId = event.callId;
		try {
			super.onLanguageModelCallStart(event);
		} finally {
			this.startingCallId = undefined;
		}
	}

	override onLanguageModelCallEnd(
		event: LanguageModelCallEndEvent<ToolSet>,
	): void {
		super.onLanguageModelCallEnd(event);
		this.attempts.delete(event.callId);
	}

	onLanguageModelCallError({
		callId,
		error,
	}: {
		callId: string;
		error: unknown;
	}): void {
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
		super.onError(error);
		if (
			typeof error === "object" &&
			error !== null &&
			"callId" in error &&
			typeof error.callId === "string"
		) {
			this.attempts.delete(error.callId);
		}
	}

	override onEnd(
		event: Parameters<LangfuseVercelAiSdkIntegration["onEnd"]>[0],
	): void {
		super.onEnd(event);
		this.attempts.delete(event.callId);
	}

	override onAbort(
		event: Parameters<LangfuseVercelAiSdkIntegration["onAbort"]>[0],
	): void {
		super.onAbort(event);
		this.attempts.delete(event.callId);
	}
}
