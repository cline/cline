import type {
	AgentConfig,
	AgentHooks,
	AgentResult,
	AgentTeamsRuntime,
	DelegatedAgentConfigProvider,
	Tool,
} from "@clinebot/agents";
import type { BasicLogger, ITelemetryService } from "@clinebot/shared";
import type { UserInstructionConfigWatcher } from "../agents";
import type { ToolExecutors } from "../tools";
import type { CoreSessionConfig } from "../types/config";

export interface BuiltRuntime {
	tools: Tool[];
	hooks?: AgentHooks;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	teamRuntime?: AgentTeamsRuntime;
	teamRestoredFromPersistence?: boolean;
	delegatedAgentConfigProvider?: DelegatedAgentConfigProvider;
	completionGuard?: () => string | undefined;
	shutdown: (reason: string) => Promise<void> | void;
}

export interface RuntimeBuilderInput {
	config: CoreSessionConfig;
	hooks?: AgentHooks;
	extensions?: AgentConfig["extensions"];
	onTeamEvent?: (event: import("@clinebot/agents").TeamEvent) => void;
	createSpawnTool?: () => Tool;
	onTeamRestored?: () => void;
	userInstructionWatcher?: UserInstructionConfigWatcher;
	defaultToolExecutors?: Partial<ToolExecutors>;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}

export interface RuntimeBuilder {
	build(input: RuntimeBuilderInput): BuiltRuntime;
}

export interface SessionRuntime {
	start(config: CoreSessionConfig): Promise<{ sessionId: string }>;
	send(sessionId: string, prompt: string): Promise<AgentResult | undefined>;
	abort(sessionId: string, reason?: unknown): Promise<void>;
	stop(sessionId: string): Promise<void>;
	poll(): Promise<string[]>;
}
