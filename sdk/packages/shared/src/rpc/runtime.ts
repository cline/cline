import type {
	SessionExecutionConfig,
	SessionPromptConfig,
} from "../session/runtime-config";

export interface ChatRuntimeConfig extends SessionPromptConfig {
	cwd?: string;
	apiKey?: string;
	logger?: RuntimeLoggerConfig;
	enableTools: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	disableMcpSettingsTools?: boolean;
	autoApproveTools?: boolean;
	missionStepInterval?: number;
	missionTimeIntervalMs?: number;
	toolPolicies?: SessionExecutionConfig["toolPolicies"];
}

export interface RuntimeLoggerConfig {
	enabled?: boolean;
	level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
	destination?: string;
	name?: string;
	bindings?: Record<string, string | number | boolean>;
}

export interface ChatStartSessionRequest extends ChatRuntimeConfig {
	sessionId?: string;
	workspaceRoot: string;
	provider: string;
	model: string;
	source?: string;
	interactive?: boolean;
	initialMessages?: ChatMessage[];
}

export interface ChatStartSessionArtifacts {
	sessionId: string;
	manifestPath: string;
	messagesPath: string;
}

export interface ChatStartSessionResponse {
	sessionId: string;
	startResult?: ChatStartSessionArtifacts;
}

export interface ChatAttachmentFile {
	name: string;
	content: string;
}

export interface ChatAttachments {
	userImages?: string[];
	userFiles?: ChatAttachmentFile[];
}

export interface ChatMessage {
	role?: string;
	content?: unknown;
	[key: string]: unknown;
}

export interface ChatRunTurnRequest {
	config: ChatStartSessionRequest;
	messages?: ChatMessage[];
	prompt: string;
	attachments?: ChatAttachments;
	delivery?: "queue" | "steer";
}

export interface ChatToolCallResult {
	name: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	durationMs?: number;
}

export interface ChatTurnResult {
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
	messages: ChatMessage[];
	toolCalls: ChatToolCallResult[];
}

export interface EnterpriseContext {
	projectId?: string;
	workspaceId?: string;
	organizationId?: string;
}

export interface EnterpriseAuthenticateRequest extends EnterpriseContext {
	providerId: string;
	workspacePath: string;
	rootPath?: string;
}

export interface EnterpriseAuthenticateResponse {
	providerId: string;
	authenticated: boolean;
	roles: string[];
	claims?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface EnterpriseSyncRequest extends EnterpriseContext {
	providerId: string;
	workspacePath: string;
	rootPath?: string;
	useCachedBundle?: boolean;
}

export interface EnterpriseSyncResponse {
	providerId: string;
	authenticated: boolean;
	hasCachedBundle: boolean;
	appliedConfigVersion?: string;
	roles: string[];
	hasTelemetryOverrides: boolean;
	rulesCount: number;
	workflowsCount: number;
	skillsCount: number;
	claims?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface EnterpriseStatusRequest {
	providerId: string;
	workspacePath: string;
	rootPath?: string;
}

export type EnterpriseStatusResponse = EnterpriseSyncResponse;

export interface ProviderModel {
	id: string;
	name: string;
	supportsAttachments?: boolean;
	supportsVision?: boolean;
	supportsReasoning?: boolean;
}

export interface ProviderListItem {
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
	modelList?: ProviderModel[];
	family?: string;
}

export interface ProviderCatalogResponse {
	providers: ProviderListItem[];
	settingsPath: string;
}

export interface ProviderModelsResponse {
	providerId: string;
	models: ProviderModel[];
}

import type { OAuthProviderId } from "../types/auth";

export type ProviderCapability =
	| "reasoning"
	| "prompt-cache"
	| "streaming"
	| "tools"
	| "vision"
	| "computer-use"
	| "oauth";

export interface ListProvidersActionRequest {
	action: "listProviders";
}

export interface GetProviderModelsActionRequest {
	action: "getProviderModels";
	providerId: string;
}

export interface SaveProviderSettingsActionRequest {
	action: "saveProviderSettings";
	providerId: string;
	enabled?: boolean;
	// Authentication
	apiKey?: string;
	auth?: {
		apiKey?: string;
		accessToken?: string;
		refreshToken?: string;
		expiresAt?: number;
		accountId?: string;
	};
	// Model configuration
	model?: string;
	maxTokens?: number;
	contextWindow?: number;
	// Endpoint configuration
	baseUrl?: string;
	headers?: Record<string, string>;
	timeout?: number;
	// Reasoning/thinking configuration
	reasoning?: {
		enabled?: boolean;
		effort?: "none" | "low" | "medium" | "high" | "xhigh";
		budgetTokens?: number;
	};
	// AWS/Bedrock configuration
	aws?: {
		accessKey?: string;
		secretKey?: string;
		sessionToken?: string;
		region?: string;
		profile?: string;
		authentication?: "iam" | "api-key" | "profile";
		usePromptCache?: boolean;
		useCrossRegionInference?: boolean;
		useGlobalInference?: boolean;
		endpoint?: string;
		customModelBaseId?: string;
	};
	// GCP/Vertex configuration
	gcp?: {
		projectId?: string;
		region?: string;
	};
	// Azure configuration
	azure?: {
		apiVersion?: string;
		useIdentity?: boolean;
	};
	// SAP AI Core configuration
	sap?: {
		clientId?: string;
		clientSecret?: string;
		tokenUrl?: string;
		resourceGroup?: string;
		deploymentId?: string;
		useOrchestrationMode?: boolean;
		api?: "orchestration" | "foundation-models";
		defaultSettings?: Record<string, unknown>;
	};
	// OCA configuration
	oca?: {
		mode?: "internal" | "external";
		usePromptCache?: boolean;
	};
	// Region configuration
	region?: string;
	apiLine?: "china" | "international";
	// Capabilities
	capabilities?: (
		| "reasoning"
		| "prompt-cache"
		| "streaming"
		| "tools"
		| "vision"
		| "computer-use"
		| "oauth"
	)[];
}

export interface AddProviderActionRequest {
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
	capabilities?: ProviderCapability[];
}

export type ProviderSettingsActionRequest =
	| ListProvidersActionRequest
	| GetProviderModelsActionRequest
	| SaveProviderSettingsActionRequest
	| AddProviderActionRequest;

export type ClineAccountActionRequest =
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
	  }
	| {
			action: "clineAccount";
			operation: "fetchFeaturebaseToken";
	  };

export type ProviderActionRequest =
	| ProviderSettingsActionRequest
	| ClineAccountActionRequest;

export interface ProviderOAuthLoginResponse {
	provider: OAuthProviderId;
	accessToken: string;
}
