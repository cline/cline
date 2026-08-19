import type { ITelemetryService } from "@cline/shared";
import { CORE_TELEMETRY_EVENTS } from "../services/telemetry/core-events";
import { SessionSource } from "../types/common";
import type { ClineCoreStartInput } from "./types";

export interface EmitSessionStartedTelemetryInput {
	input: ClineCoreStartInput;
	sessionId: string;
	telemetry?: ITelemetryService;
	clientName?: string;
	runtimeAddress?: string;
}

export function emitSessionStartedTelemetry(
	input: EmitSessionStartedTelemetryInput,
): void {
	// Per-session telemetry override (passed via `CoreSessionConfig.telemetry`)
	// takes precedence over the instance-wide telemetry service configured on
	// `ClineCore.create`. Either way we fire a single `session.started` event
	// here so the signal is emitted for every backend.
	const telemetry = input.input.config.telemetry ?? input.telemetry;
	if (!telemetry) {
		return;
	}
	telemetry.capture({
		event: CORE_TELEMETRY_EVENTS.SESSION.STARTED,
		properties: {
			sessionId: input.sessionId,
			source: input.input.source ?? SessionSource.CORE,
			providerId: input.input.config.providerId,
			modelId: input.input.config.modelId,
			enableTools: input.input.config.enableTools,
			enableSpawnAgent: input.input.config.enableSpawnAgent,
			enableAgentTeams: input.input.config.enableAgentTeams,
			clientName: input.clientName,
			runtimeAddress: input.runtimeAddress,
		},
	});
}
