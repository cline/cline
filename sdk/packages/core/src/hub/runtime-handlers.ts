import { normalizeProviderId } from "@clinebot/llms";
import type {
	ChatRunTurnRequest,
	ChatStartSessionRequest,
	ChatTurnResult,
} from "@clinebot/shared";
import { SqliteSessionStore } from "../services/storage/sqlite-session-store";
import { CoreSessionService } from "../session/session-service";
import { LocalRuntimeHost } from "../transports/local";
import { SessionSource } from "../types/common";
import type {
	HubScheduleRuntimeHandlers,
	HubScheduleServiceOptions,
} from "./schedule-service";

function toChatTurnResult(result: {
	text: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalCost?: number;
	};
	iterations: number;
	finishReason: string;
	messages: unknown[];
	toolCalls: Array<{
		name: string;
		input?: unknown;
		output?: unknown;
		error?: string;
		durationMs?: number;
	}>;
}): ChatTurnResult {
	return {
		text: result.text,
		usage: result.usage,
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		iterations: result.iterations,
		finishReason: result.finishReason,
		messages: result.messages as never,
		toolCalls: result.toolCalls.map((call) => ({
			name: call.name,
			input: call.input,
			output: call.output,
			error: call.error,
			durationMs: call.durationMs,
		})),
	};
}

function resolveMode(
	request: ChatStartSessionRequest | ChatRunTurnRequest["config"],
): "act" | "plan" | "yolo" {
	return request.mode === "plan"
		? "plan"
		: request.mode === "yolo"
			? "yolo"
			: "act";
}

export function createLocalHubScheduleRuntimeHandlers(
	_options: Pick<HubScheduleServiceOptions, "logger"> = {},
): HubScheduleRuntimeHandlers {
	const sessionHost = new LocalRuntimeHost({
		sessionService: new CoreSessionService(new SqliteSessionStore()),
	});

	return {
		async startSession(request) {
			const cwd = (request.cwd?.trim() || request.workspaceRoot).trim();
			const started = await sessionHost.start({
				source: SessionSource.CLI,
				interactive: false,
				config: {
					providerId: normalizeProviderId(request.provider),
					modelId: request.model,
					apiKey: request.apiKey?.trim() || undefined,
					cwd,
					workspaceRoot: request.workspaceRoot,
					systemPrompt: request.systemPrompt ?? "",
					mode: resolveMode(request),
					maxIterations: request.maxIterations,
					enableTools: request.enableTools !== false,
					enableSpawnAgent: request.enableSpawn !== false,
					enableAgentTeams: request.enableTeams !== false,
					disableMcpSettingsTools: request.disableMcpSettingsTools,
					missionLogIntervalSteps: request.missionStepInterval,
					missionLogIntervalMs: request.missionTimeIntervalMs,
				},
				toolPolicies: request.toolPolicies ?? {
					"*": {
						autoApprove: request.autoApproveTools !== false,
					},
				},
			});
			return {
				sessionId: started.sessionId,
				startResult: {
					sessionId: started.sessionId,
					manifestPath: started.manifestPath,
					messagesPath: started.messagesPath,
				},
			};
		},
		async sendSession(sessionId, request) {
			const result = await sessionHost.send({
				sessionId,
				prompt: request.prompt,
				userImages: request.attachments?.userImages,
				userFiles: request.attachments?.userFiles?.map((file) => file.content),
			});
			if (!result) {
				throw new Error("local hub schedule runtime returned no turn result");
			}
			return {
				result: toChatTurnResult(result),
			};
		},
		async abortSession(sessionId) {
			await sessionHost.abort(sessionId, new Error("hub schedule abort"));
			return { applied: true };
		},
		async stopSession(sessionId) {
			await sessionHost.stop(sessionId);
			return { applied: true };
		},
	};
}
