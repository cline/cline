import type { ITelemetryService } from "@cline/shared";
import { pullRequestTelemetrySchema } from "../webview/lib/pull-request-telemetry-schema";

export function capturePullRequestEvent(
	telemetry: ITelemetryService | undefined,
	input: unknown,
): void {
	const parsed = pullRequestTelemetrySchema.safeParse(input);
	if (!parsed.success) return;
	try {
		if (!telemetry?.isEnabled()) return;
		const { action, ...properties } = parsed.data;
		telemetry.capture({ event: `desktop.pull_request.${action}`, properties });
	} catch {
		// Product interactions must continue if the telemetry provider fails.
	}
}
