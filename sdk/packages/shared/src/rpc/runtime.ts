import type {
	AgentMode,
	SessionExecutionConfig,
	SessionPromptConfig,
} from "../session/runtime-config";

export type RpcAgentMode = AgentMode;

export interface RpcSessionStorageOptions {
	homeDir?: string;
}

export interface RpcChatRuntimeConfigBase extends SessionPromptConfig {
	cwd?: string;
	apiKey: string;
	logger?: RpcChatRuntimeLoggerConfig;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	autoApproveTools?: boolean;
	teamName: string;
	missionStepInterval: number;
	missionTimeIntervalMs: number;
	toolPolicies?: SessionExecutionConfig["toolPolicies"];
}

export interface RpcChatRuntimeLoggerConfig {
	enabled?: boolean;
	level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
	destination?: string;
	name?: string;
	bindings?: Record<string, string | number | boolean>;
}

export interface RpcChatStartSessionRequest extends RpcChatRuntimeConfigBase {
	sessionId?: string;
	workspaceRoot: string;
	provider: string;
	model: string;
	sessions?: RpcSessionStorageOptions;
	initialMessages?: RpcChatMessage[];
}

export interface RpcChatStartSessionArtifacts {
	sessionId: string;
	manifestPath: string;
	transcriptPath: string;
	hookPath: string;
	messagesPath: string;
}

export interface RpcChatStartSessionResponse {
	sessionId: string;
	startResult?: RpcChatStartSessionArtifacts;
}

export interface RpcChatAttachmentFile {
	name: string;
	content: string;
}

export interface RpcChatAttachments {
	userImages?: string[];
	userFiles?: RpcChatAttachmentFile[];
}

export interface RpcChatMessage {
	role?: string;
	content?: unknown;
	[key: string]: unknown;
}

export interface RpcChatRunTurnRequest {
	config: RpcChatStartSessionRequest;
	messages?: RpcChatMessage[];
	prompt: string;
	attachments?: RpcChatAttachments;
	delivery?: "queue" | "steer";
}

export interface RpcChatToolCallResult {
	name: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	durationMs?: number;
}

export interface RpcChatTurnResult {
	text: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	};
	inputTokens: number;
	outputTokens: number;
	iterations: number;
	finishReason: string;
	messages: RpcChatMessage[];
	toolCalls: RpcChatToolCallResult[];
}

export interface RpcProviderModel {
	id: string;
	name: string;
	supportsAttachments?: boolean;
	supportsVision?: boolean;
	supportsReasoning?: boolean;
}

export interface RpcProviderListItem {
	id: string;
	name: string;
	models: number | null;
	color: string;
	letter: string;
	enabled: boolean;
	apiKey?: string;
	oauthAccessTokenPresent?: boolean;
	baseUrl?: string;
	defaultModelId?: string;
	authDescription: string;
	baseUrlDescription: string;
	modelList?: RpcProviderModel[];
}

export interface RpcProviderCatalogResponse {
	providers: RpcProviderListItem[];
	settingsPath: string;
}

export interface RpcProviderModelsResponse {
	providerId: string;
	models: RpcProviderModel[];
}

export interface RpcClineAccountOrganization {
	active: boolean;
	memberId: string;
	name: string;
	organizationId: string;
	roles: Array<"admin" | "member" | "owner">;
}

export interface RpcClineAccountUser {
	id: string;
	email: string;
	displayName: string;
	photoUrl: string;
	createdAt: string;
	updatedAt: string;
	organizations: RpcClineAccountOrganization[];
}

export interface RpcClineAccountBalance {
	balance: number;
	userId: string;
}

export interface RpcClineAccountUsageTransaction {
	aiInferenceProviderName: string;
	aiModelName: string;
	aiModelTypeName: string;
	completionTokens: number;
	costUsd: number;
	createdAt: string;
	creditsUsed: number;
	generationId: string;
	id: string;
	metadata: {
		additionalProp1: string;
		additionalProp2: string;
		additionalProp3: string;
	};
	operation?: string;
	organizationId: string;
	promptTokens: number;
	totalTokens: number;
	userId: string;
}

export interface RpcClineAccountPaymentTransaction {
	paidAt: string;
	creatorId: string;
	amountCents: number;
	credits: number;
}

export interface RpcClineAccountOrganizationBalance {
	balance: number;
	organizationId: string;
}

export interface RpcClineAccountOrganizationUsageTransaction {
	aiInferenceProviderName: string;
	aiModelName: string;
	aiModelTypeName: string;
	completionTokens: number;
	costUsd: number;
	createdAt: string;
	creditsUsed: number;
	generationId: string;
	id: string;
	memberDisplayName: string;
	memberEmail: string;
	metadata: {
		additionalProp1: string;
		additionalProp2: string;
		additionalProp3: string;
	};
	operation?: string;
	organizationId: string;
	promptTokens: number;
	totalTokens: number;
	userId: string;
}

import type { OAuthProviderId } from "../auth/constants";

export type RpcOAuthProviderId = OAuthProviderId;

export type RpcProviderCapability =
	| "reasoning"
	| "prompt-cache"
	| "streaming"
	| "tools"
	| "vision";

export interface RpcListProvidersActionRequest {
	action: "listProviders";
}

export interface RpcGetProviderModelsActionRequest {
	action: "getProviderModels";
	providerId: string;
}

export interface RpcSaveProviderSettingsActionRequest {
	action: "saveProviderSettings";
	providerId: string;
	enabled?: boolean;
	apiKey?: string;
	baseUrl?: string;
}

export interface RpcAddProviderActionRequest {
	action: "addProvider";
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models?: string[];
	defaultModelId?: string;
	modelsSourceUrl?: string;
	capabilities?: RpcProviderCapability[];
}

export type RpcProviderSettingsActionRequest =
	| RpcListProvidersActionRequest
	| RpcGetProviderModelsActionRequest
	| RpcSaveProviderSettingsActionRequest
	| RpcAddProviderActionRequest;

export type RpcClineAccountActionRequest =
	| {
			action: "clineAccount";
			operation: "fetchMe";
	  }
	| {
			action: "clineAccount";
			operation: "fetchBalance";
			userId?: string;
	  }
	| {
			action: "clineAccount";
			operation: "fetchUsageTransactions";
			userId?: string;
	  }
	| {
			action: "clineAccount";
			operation: "fetchPaymentTransactions";
			userId?: string;
	  }
	| {
			action: "clineAccount";
			operation: "fetchUserOrganizations";
	  }
	| {
			action: "clineAccount";
			operation: "fetchOrganizationBalance";
			organizationId: string;
	  }
	| {
			action: "clineAccount";
			operation: "fetchOrganizationUsageTransactions";
			organizationId: string;
			memberId?: string;
	  }
	| {
			action: "clineAccount";
			operation: "switchAccount";
			organizationId?: string | null;
	  };

export type RpcProviderActionRequest =
	| RpcProviderSettingsActionRequest
	| RpcClineAccountActionRequest;

export interface RpcProviderOAuthLoginResponse {
	provider: RpcOAuthProviderId;
	accessToken: string;
}
