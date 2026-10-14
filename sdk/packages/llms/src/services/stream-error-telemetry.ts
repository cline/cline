import type { Telemetry } from "ai";
import type { AiSdkTelemetryDecision } from "./langfuse-telemetry";

/** Connect application-level stream failures to the operation's tracing lifecycle. */
export function createStreamErrorTelemetry(decision: AiSdkTelemetryDecision): {
	telemetry: AiSdkTelemetryDecision;
	recordError: (error: unknown) => Promise<void>;
} {
	const integrations = decision.integrations
		? Array.isArray(decision.integrations)
			? decision.integrations
			: [decision.integrations]
		: [];
	let callId: string | undefined;
	let failed = false;
	const lifecycle: Telemetry = {
		onStart(event) {
			callId = event.callId;
		},
		onError() {
			failed = true;
		},
		onEnd() {
			callId = undefined;
		},
		onAbort() {
			callId = undefined;
		},
	};
	return {
		telemetry:
			decision.isEnabled && integrations.length > 0
				? { ...decision, integrations: [lifecycle, ...integrations] }
				: decision,
		async recordError(error) {
			if (!callId || failed) return;
			failed = true;
			// Error stream parts invoke the application's onError without notifying
			// tracing integrations. Supply the operation ID captured by onStart.
			await Promise.all(
				integrations.map((integration) =>
					integration.onError?.({ callId, error }),
				),
			);
		},
	};
}
