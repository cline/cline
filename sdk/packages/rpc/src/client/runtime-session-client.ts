import type {
	RpcChatRunTurnRequest,
	RpcChatStartSessionArtifacts,
	RpcChatStartSessionRequest,
	RpcChatStartSessionResponse,
	RpcChatTurnResult,
	RpcProviderActionRequest,
} from "@clinebot/shared";
import type { AbortRuntimeSessionResponse__Output } from "../proto/generated/cline/rpc/v1/AbortRuntimeSessionResponse";
import type { ClineGatewayClient } from "../proto/generated/cline/rpc/v1/ClineGateway";
import type { RunProviderActionResponse__Output } from "../proto/generated/cline/rpc/v1/RunProviderActionResponse";
import type { RunProviderOAuthLoginResponse__Output } from "../proto/generated/cline/rpc/v1/RunProviderOAuthLoginResponse";
import type { SendRuntimeSessionResponse__Output } from "../proto/generated/cline/rpc/v1/SendRuntimeSessionResponse";
import type { StartRuntimeSessionResponse__Output } from "../proto/generated/cline/rpc/v1/StartRuntimeSessionResponse";
import type { StopRuntimeSessionResponse__Output } from "../proto/generated/cline/rpc/v1/StopRuntimeSessionResponse";
import { fromProtoValue, toProtoValue } from "../proto/serde";
import { toRuntimeConfig } from "./runtime-config";
import { unary } from "./unary";

export class RuntimeSessionClient {
	constructor(private readonly client: ClineGatewayClient) {}

	async startRuntimeSession(
		request: RpcChatStartSessionRequest,
	): Promise<RpcChatStartSessionResponse> {
		const response = await unary<StartRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.StartRuntimeSession(
					{
						request: {
							...toRuntimeConfig(request),
							sessionId: request.sessionId ?? "",
						},
					},
					callback,
				);
			},
		);
		const startResult: RpcChatStartSessionArtifacts | undefined =
			response.startResult
				? {
						sessionId: response.startResult.sessionId ?? "",
						manifestPath: response.startResult.manifestPath ?? "",
						transcriptPath: response.startResult.transcriptPath ?? "",
						messagesPath: response.startResult.messagesPath ?? "",
					}
				: undefined;
		return {
			sessionId: response.sessionId ?? "",
			startResult,
		};
	}

	async sendRuntimeSession(
		sessionId: string,
		request: RpcChatRunTurnRequest,
	): Promise<{ result?: RpcChatTurnResult; queued?: boolean }> {
		const response = await unary<SendRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.SendRuntimeSession(
					{
						sessionId,
						request: {
							config: toRuntimeConfig(request.config),
							messages: (request.messages ?? []).map((message) => ({
								role: message.role ?? "",
								content: toProtoValue(message.content),
							})),
							prompt: request.prompt,
							delivery: request.delivery,
							attachments: request.attachments
								? {
										userImages: request.attachments.userImages ?? [],
										userFiles: (request.attachments.userFiles ?? []).map(
											(file) => ({ name: file.name, content: file.content }),
										),
									}
								: undefined,
						},
					},
					callback,
				);
			},
		);
		if (!response.result) {
			return { queued: true };
		}
		return {
			result: {
				text: response.result.text ?? "",
				usage: {
					inputTokens: Number(response.result.usage?.inputTokens ?? 0),
					outputTokens: Number(response.result.usage?.outputTokens ?? 0),
					cacheReadTokens: response.result.usage?.hasCacheReadTokens
						? Number(response.result.usage.cacheReadTokens ?? 0)
						: undefined,
					cacheWriteTokens: response.result.usage?.hasCacheWriteTokens
						? Number(response.result.usage.cacheWriteTokens ?? 0)
						: undefined,
					totalCost: response.result.usage?.hasTotalCost
						? Number(response.result.usage.totalCost ?? 0)
						: undefined,
				},
				inputTokens: Number(response.result.inputTokens ?? 0),
				outputTokens: Number(response.result.outputTokens ?? 0),
				iterations: Number(response.result.iterations ?? 0),
				finishReason: response.result.finishReason ?? "",
				messages: (response.result.messages ?? []).map((message) => ({
					role: message.role ?? "",
					content: fromProtoValue(message.content),
				})),
				toolCalls: (response.result.toolCalls ?? []).map((call) => ({
					name: call.name ?? "",
					input: call.hasInput ? fromProtoValue(call.input) : undefined,
					output: call.hasOutput ? fromProtoValue(call.output) : undefined,
					error: call.error?.trim() || undefined,
					durationMs: call.hasDurationMs
						? Number(call.durationMs ?? 0)
						: undefined,
				})),
			},
			queued: false,
		};
	}

	async abortRuntimeSession(sessionId: string): Promise<{ applied: boolean }> {
		const response = await unary<AbortRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.AbortRuntimeSession({ sessionId }, callback);
			},
		);
		return { applied: response.applied === true };
	}

	async stopRuntimeSession(sessionId: string): Promise<{ applied: boolean }> {
		const response = await unary<StopRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.StopRuntimeSession({ sessionId }, callback);
			},
		);
		return { applied: response.applied === true };
	}

	async runProviderAction(
		request: RpcProviderActionRequest,
	): Promise<{ result: unknown }> {
		const rpcRequest =
			request.action === "listProviders"
				? { listProviders: {} }
				: request.action === "getProviderModels"
					? { getProviderModels: { providerId: request.providerId } }
					: request.action === "addProvider"
						? {
								addProvider: {
									providerId: request.providerId,
									name: request.name,
									baseUrl: request.baseUrl,
									apiKey: request.apiKey ?? "",
									headers: request.headers ?? {},
									timeoutMs: request.timeoutMs ?? 0,
									hasTimeoutMs: typeof request.timeoutMs === "number",
									models: request.models ?? [],
									defaultModelId: request.defaultModelId ?? "",
									modelsSourceUrl: request.modelsSourceUrl ?? "",
									capabilities: request.capabilities ?? [],
								},
							}
						: request.action === "saveProviderSettings"
							? {
									saveProviderSettings: {
										providerId: request.providerId,
										enabled: request.enabled ?? false,
										hasEnabled: typeof request.enabled === "boolean",
										apiKey: request.apiKey ?? "",
										hasApiKey: request.apiKey !== undefined,
										baseUrl: request.baseUrl ?? "",
										hasBaseUrl: request.baseUrl !== undefined,
									},
								}
							: {
									clineAccount: {
										operation: request.operation,
										userId: "userId" in request ? (request.userId ?? "") : "",
										organizationId:
											"organizationId" in request
												? (request.organizationId ?? "")
												: "",
										memberId:
											"memberId" in request ? (request.memberId ?? "") : "",
										clearOrganizationId:
											"organizationId" in request &&
											request.organizationId === null,
									},
								};
		const response = await unary<RunProviderActionResponse__Output>(
			(callback) => {
				this.client.RunProviderAction({ request: rpcRequest }, callback);
			},
		);
		return { result: fromProtoValue(response.result) };
	}

	async runProviderOAuthLogin(
		provider: string,
	): Promise<{ provider: string; accessToken: string }> {
		const response = await unary<RunProviderOAuthLoginResponse__Output>(
			(callback) => {
				this.client.RunProviderOAuthLogin({ provider }, callback);
			},
		);
		return {
			provider: response.provider ?? "",
			accessToken: response.apiKey ?? "",
		};
	}
}
