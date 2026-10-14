import type { Telemetry } from "ai";
import type { AiSdkTelemetryDecision } from "./langfuse-telemetry";

/** Connect application-level stream failures to the operation's tracing lifecycle. */
export function createStreamErrorTelemetry(decision: AiSdkTelemetryDecision): {
	telemetry: AiSdkTelemetryDecision;
	recordError: (error: unknown) => Promise<void>;
	captureError: (error: unknown) => void;
	getCallId: () => string | undefined;
} {
	const integrations = decision.integrations
		? Array.isArray(decision.integrations)
			? decision.integrations
			: [decision.integrations]
		: [];
	let callId: string | undefined;
	let failed = false;
	let pendingError: unknown;
	const lifecycle: Telemetry = {
		onStart(event) {
			callId = event.callId;
		},
		onError() {
			failed = true;
		},
		onLanguageModelCallStart() {
			// A new provider attempt can recover a previously reported error part.
			pendingError = undefined;
		},
		async onEnd(event) {
			if (
				"finishReason" in event &&
				event.finishReason === "error" &&
				pendingError !== undefined
			) {
				await recordError(pendingError);
			}
			callId = undefined;
		},
		async onAbort(event) {
			if (isTimeoutReason(event.reason)) await recordError(event.reason);
			callId = undefined;
		},
	};
	async function recordError(error: unknown) {
		if (!callId || failed) return;
		failed = true;
		await Promise.all(
			integrations.map((integration) =>
				integration.onError?.({ callId, error }),
			),
		);
	}
	return {
		telemetry:
			decision.isEnabled && integrations.length > 0
				? { ...decision, integrations: [lifecycle, ...integrations] }
				: decision,
		// Error stream parts do not always notify tracing integrations.
		recordError,
		captureError: (error) => {
			pendingError = error;
		},
		getCallId: () => callId,
	};
}

/** Native AbortSignal timeouts are distinct from user cancellation. */
export function isTimeoutReason(reason: unknown): boolean {
	return (
		typeof reason === "object" &&
		reason !== null &&
		"name" in reason &&
		reason.name === "TimeoutError"
	);
}
