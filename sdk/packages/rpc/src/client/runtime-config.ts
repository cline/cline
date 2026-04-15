import type { RpcChatStartSessionRequest } from "@clinebot/shared";
import { toProtoStruct, toProtoValue } from "../proto/serde";

export function toRuntimeConfig(config: RpcChatStartSessionRequest) {
	return {
		workspaceRoot: config.workspaceRoot,
		cwd: config.cwd ?? "",
		provider: config.provider,
		model: config.model,
		mode: config.mode,
		apiKey: config.apiKey,
		systemPrompt: config.systemPrompt ?? "",
		maxIterations: config.maxIterations ?? 0,
		hasMaxIterations: typeof config.maxIterations === "number",
		enableTools: config.enableTools,
		enableSpawn: config.enableSpawn,
		enableTeams: config.enableTeams,
		disableMcpSettingsTools: config.disableMcpSettingsTools ?? false,
		autoApproveTools: config.autoApproveTools ?? false,
		hasAutoApproveTools: typeof config.autoApproveTools === "boolean",
		teamName: config.teamName,
		missionStepInterval: config.missionStepInterval,
		missionTimeIntervalMs: config.missionTimeIntervalMs,
		toolPolicies: Object.fromEntries(
			Object.entries(config.toolPolicies ?? {}).map(([name, policy]) => [
				name,
				{
					enabled: policy.enabled !== false,
					autoApprove: policy.autoApprove ?? false,
				},
			]),
		),
		initialMessages: (config.initialMessages ?? []).map((message) => ({
			role: message.role ?? "",
			content: toProtoValue(message.content),
		})),
		logger: config.logger
			? {
					enabled: config.logger.enabled ?? false,
					level: config.logger.level ?? "",
					destination: config.logger.destination ?? "",
					name: config.logger.name ?? "",
					bindings: toProtoStruct(
						config.logger.bindings as Record<string, unknown> | undefined,
					),
				}
			: undefined,
		source: config.source ?? "",
		interactive: config.interactive === true,
	};
}
