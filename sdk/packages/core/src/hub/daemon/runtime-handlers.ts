import { normalizeProviderId } from "@cline/llms";
import type {
	ChatRunTurnRequest,
	ChatStartSessionRequest,
	ChatTurnResult
} from "@cline/shared";
import type {
	HubScheduleRuntimeHandlers,
} from "../../cron/service/schedule-service";
import type { VerifySubmitExecutor } from "../../extensions/tools";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { CoreSessionService } from "../../session/services/session-service";
import { SessionSource } from "../../types/common";

function toChatTurnResult(result: {
	text: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalCost?: number;
	};
	iterations: number;
	finishReason: string;
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
): "act" | "plan" {
	return request.mode === "plan" ? "plan" : "act";
}

export function createLocalHubScheduleRuntimeHandlers(): HubScheduleRuntimeHandlers {
	const submitScheduledRun: VerifySubmitExecutor = async (summary) => summary;
	const sessionHost = new LocalRuntimeHost({
		sessionService: new CoreSessionService(new SqliteSessionStore()),
		capabilities: {
			toolExecutors: {
				submit: submitScheduledRun,
			},
		}
	});

	return {
		async startSession(request) {
			const cwd = (request.cwd?.trim() || request.workspaceRoot).trim();
			const started = await sessionHost.startSession({
				source: request.source?.trim() || SessionSource.CLI,
				interactive: false,
				config: {
					providerId: normalizeProviderId(request.provider),
					modelId: request.model,
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
				toolPolicies: request.toolPolicies,
				localRuntime: {
					configExtensions: request.configExtensions,
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
			const result = await sessionHost.runTurn({
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
			await sessionHost.stopSession(sessionId);
			return { applied: true };
		},
	};
}
