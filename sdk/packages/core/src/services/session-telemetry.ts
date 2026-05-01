import type { ITelemetryService } from "@clinebot/shared";
import { resolveDocumentsExtensionPath } from "@clinebot/shared/storage";
import { listHookConfigFiles } from "../hooks/hook-file-config";
import type { CoreSessionConfig } from "../types/config";
import {
	captureHookDiscovery,
	captureMentionFailed,
	captureMentionSearchResults,
	captureMentionUsed,
	captureTaskCreated,
	captureTaskRestarted,
	type TelemetryAgentIdentityProperties,
} from "./telemetry/core-events";
import type { enrichPromptWithMentions } from "./workspace";

/**
 * Emits local-only session creation telemetry (task.created/restarted and
 * hook discovery). The transport-agnostic `session.started` event is
 * emitted from `ClineCore.start` so it fires for every backend (local,
 * hub, remote) at the outer API boundary.
 */
export function emitSessionCreationTelemetry(
	config: CoreSessionConfig,
	sessionId: string,
	isRestart: boolean,
	workspacePath: string,
	agentIdentity?: Partial<TelemetryAgentIdentityProperties>,
): void {
	if (isRestart) {
		captureTaskRestarted(config.telemetry, {
			ulid: sessionId,
			apiProvider: config.providerId,
			...agentIdentity,
		});
	} else {
		captureTaskCreated(config.telemetry, {
			ulid: sessionId,
			apiProvider: config.providerId,
			...agentIdentity,
		});
	}
	captureHookDiscoveryTelemetry(config.telemetry, { workspacePath });
}

export function captureHookDiscoveryTelemetry(
	telemetry: ITelemetryService | undefined,
	options: { workspacePath: string },
): void {
	const globalHooksDir = resolveDocumentsExtensionPath("Hooks");
	const entries = listHookConfigFiles(options.workspacePath);
	const counts = new Map<string, { global: number; workspace: number }>();
	for (const entry of entries) {
		const hookName = entry.hookEventName ?? "unknown";
		const current = counts.get(hookName) ?? { global: 0, workspace: 0 };
		if (
			entry.path === globalHooksDir ||
			entry.path.startsWith(`${globalHooksDir}/`)
		) {
			current.global += 1;
		} else {
			current.workspace += 1;
		}
		counts.set(hookName, current);
	}
	for (const [hookName, count] of counts.entries()) {
		captureHookDiscovery(telemetry, hookName, count.global, count.workspace);
	}
}

export function emitMentionTelemetry(
	telemetry: ITelemetryService | undefined,
	enriched: Awaited<ReturnType<typeof enrichPromptWithMentions>>,
): void {
	for (const mention of enriched.mentions) {
		captureMentionSearchResults(
			telemetry,
			mention,
			enriched.matchedFiles.includes(mention) ? 1 : 0,
			"file",
			!enriched.matchedFiles.includes(mention),
		);
	}
	for (const matched of enriched.matchedFiles) {
		captureMentionUsed(telemetry, "file", matched.length);
	}
	for (const ignored of enriched.ignoredMentions) {
		captureMentionFailed(telemetry, "file", "not_found", ignored);
	}
}
