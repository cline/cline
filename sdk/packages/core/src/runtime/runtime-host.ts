import type * as LlmsProviders from "@clinebot/llms";
import type {
	AgentResult,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/shared";
import type { HookEventPayload } from "../hooks";
import type { SessionManifest } from "../session/session-manifest";
import type { SessionSource } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
import type { SessionRecord } from "../types/sessions";

export interface RuntimeSessionConfig {
	sessionId?: string;
	providerId: string;
	modelId: string;
	apiKey?: string;
	cwd: string;
	workspaceRoot?: string;
	systemPrompt: string;
	mode: CoreSessionConfig["mode"];
	rules?: CoreSessionConfig["rules"];
	maxIterations?: CoreSessionConfig["maxIterations"];
	enableTools: boolean;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
	disableMcpSettingsTools?: boolean;
	teamName?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
}

export type LocalRuntimeConfigOverrides = Omit<
	CoreSessionConfig,
	keyof RuntimeSessionConfig
>;

export interface LocalRuntimeStartOptions {
	configOverrides?: Partial<LocalRuntimeConfigOverrides>;
	userInstructionWatcher?: import("../extensions/config").UserInstructionConfigWatcher;
	onTeamRestored?: () => void;
}

export interface StartSessionInput {
	config: RuntimeSessionConfig;
	source?: SessionSource;
	prompt?: string;
	interactive?: boolean;
	sessionMetadata?: Record<string, unknown>;
	initialMessages?: LlmsProviders.Message[];
	userImages?: string[];
	userFiles?: string[];
	/**
	 * Local runtime bootstrap options. These are intentionally isolated under a
	 * local-only bag so the transport-facing host contract stays transport-safe.
	 */
	localRuntime?: LocalRuntimeStartOptions;
	toolPolicies?: import("@clinebot/shared").AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}

export function splitCoreSessionConfig(config: CoreSessionConfig): {
	config: RuntimeSessionConfig;
	localRuntime?: LocalRuntimeStartOptions;
} {
	const {
		sessionId,
		providerId,
		modelId,
		apiKey,
		cwd,
		workspaceRoot,
		systemPrompt,
		mode,
		rules,
		maxIterations,
		enableTools,
		enableSpawnAgent,
		enableAgentTeams,
		disableMcpSettingsTools,
		teamName,
		missionLogIntervalSteps,
		missionLogIntervalMs,
		...localConfigOverrides
	} = config;

	const localRuntime =
		Object.keys(localConfigOverrides).length > 0
			? {
					configOverrides:
						localConfigOverrides as Partial<LocalRuntimeConfigOverrides>,
				}
			: undefined;

	return {
		config: {
			...(sessionId ? { sessionId } : {}),
			providerId,
			modelId,
			...(apiKey ? { apiKey } : {}),
			cwd,
			...(workspaceRoot ? { workspaceRoot } : {}),
			systemPrompt,
			mode,
			rules,
			maxIterations,
			enableTools,
			enableSpawnAgent,
			enableAgentTeams,
			disableMcpSettingsTools,
			teamName,
			missionLogIntervalSteps,
			missionLogIntervalMs,
		},
		...(localRuntime ? { localRuntime } : {}),
	};
}

export interface StartSessionResult {
	sessionId: string;
	manifest: SessionManifest;
	manifestPath: string;
	messagesPath: string;
	result?: AgentResult;
}

export interface SendSessionInput {
	sessionId: string;
	prompt: string;
	userImages?: string[];
	userFiles?: string[];
	delivery?: "queue" | "steer";
}

export interface SessionAccumulatedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
}

/**
 * RuntimeHost is the transport/runtime boundary for core session execution.
 * Callers must normalize broad local config into `RuntimeSessionConfig`
 * plus optional `localRuntime` overrides before invoking a host.
 */
export interface RuntimeHost {
	readonly runtimeAddress?: string;
	start(input: StartSessionInput): Promise<StartSessionResult>;
	send(input: SendSessionInput): Promise<AgentResult | undefined>;
	getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionAccumulatedUsage | undefined>;
	abort(sessionId: string, reason?: unknown): Promise<void>;
	stop(sessionId: string): Promise<void>;
	dispose(reason?: string): Promise<void>;
	get(sessionId: string): Promise<SessionRecord | undefined>;
	list(limit?: number): Promise<SessionRecord[]>;
	delete(sessionId: string): Promise<boolean>;
	update(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }>;
	readMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
	handleHookEvent(payload: HookEventPayload): Promise<void>;
	subscribe(listener: (event: CoreSessionEvent) => void): () => void;
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>;
}

export type RuntimeHostMode = "auto" | "rpc" | "local";
