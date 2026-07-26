import type { HubToolExecutorName } from "../hub";
import type {
	RuntimeConfigExtensionKind,
	SessionExecutionConfig,
	SessionPromptConfig,
} from "../session/runtime-config";

export interface ChatRuntimeConfig extends SessionPromptConfig {
	cwd?: string;
	logger?: RuntimeLoggerConfig;
	enableTools: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	disableMcpSettingsTools?: boolean;
	missionStepInterval?: number;
	missionTimeIntervalMs?: number;
	timeoutSeconds?: number;
	toolPolicies?: SessionExecutionConfig["toolPolicies"];
	toolExecutors?: HubToolExecutorName[];
	configExtensions?: RuntimeConfigExtensionKind[];
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
	provider: "bedrock";
	model: string;
	source?: string;
	interactive?: boolean;
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

export interface ChatRunTurnRequest {
	config: ChatStartSessionRequest;
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
	toolCalls: ChatToolCallResult[];
}
