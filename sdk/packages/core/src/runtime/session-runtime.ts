import type {
	Agent,
	AgentConfig,
	AgentHooks,
	AgentResult,
} from "@clinebot/agents";
import type { BasicLogger, ITelemetryService, Tool } from "@clinebot/shared";
import type { UserInstructionConfigWatcher } from "../extensions/config";
import type {
	AgentTeamsRuntime,
	DelegatedAgentConfigProvider,
	TeamEvent,
} from "../team";
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
	registerLeadAgent?: (agent: Agent) => void;
	shutdown: (reason: string) => Promise<void> | void;
}

export interface RuntimeBuilderInput {
	config: CoreSessionConfig;
	hooks?: AgentHooks;
	extensions?: AgentConfig["extensions"];
	onTeamEvent?: (event: TeamEvent) => void;
	createSpawnTool?: () => Tool;
	onTeamRestored?: () => void;
	userInstructionWatcher?: UserInstructionConfigWatcher;
	defaultToolExecutors?: Partial<ToolExecutors>;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}

export interface RuntimeBuilder {
	build(input: RuntimeBuilderInput): Promise<BuiltRuntime> | BuiltRuntime;
}

export interface SessionRuntime {
	start(config: CoreSessionConfig): Promise<{ sessionId: string }>;
	send(sessionId: string, prompt: string): Promise<AgentResult | undefined>;
	abort(sessionId: string, reason?: unknown): Promise<void>;
	stop(sessionId: string): Promise<void>;
	poll(): Promise<string[]>;
}
