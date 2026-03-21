import type { ITelemetryService } from "@clinebot/shared";
import {
	listHookConfigFiles,
	resolveDocumentsHooksDirectoryPath,
} from "../agents/hooks-config-loader";
import type { enrichPromptWithMentions } from "../input";
import {
	captureHookDiscovery,
	captureMentionFailed,
	captureMentionSearchResults,
	captureMentionUsed,
	captureTaskCreated,
	captureTaskRestarted,
} from "../telemetry/core-events";
import type { SessionSource } from "../types/common";
import type { CoreSessionConfig } from "../types/config";

export function emitSessionCreationTelemetry(
	config: CoreSessionConfig,
	sessionId: string,
	source: SessionSource,
	isRestart: boolean,
	workspacePath: string,
): void {
	if (isRestart) {
		captureTaskRestarted(config.telemetry, {
			ulid: sessionId,
			apiProvider: config.providerId,
		});
	} else {
		captureTaskCreated(config.telemetry, {
			ulid: sessionId,
			apiProvider: config.providerId,
		});
	}
	captureHookDiscoveryTelemetry(config.telemetry, { workspacePath });
	config.telemetry?.capture({
		event: "session.started",
		properties: {
			sessionId,
			source,
			providerId: config.providerId,
			modelId: config.modelId,
			enableTools: config.enableTools,
			enableSpawnAgent: config.enableSpawnAgent,
			enableAgentTeams: config.enableAgentTeams,
		},
	});
}

export function captureHookDiscoveryTelemetry(
	telemetry: ITelemetryService | undefined,
	options: { workspacePath: string },
): void {
	const globalHooksDir = resolveDocumentsHooksDirectoryPath();
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
