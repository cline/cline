import type { Agent } from "@clinebot/agents";
import type {
	AgentConfig,
	AgentHooks,
	AgentResult,
	BasicLogger,
	ITelemetryService,
	TeamTeammateSpec,
	Tool,
} from "@clinebot/shared";
import type { UserInstructionConfigWatcher } from "../extensions/config";
import type { ToolExecutors } from "../extensions/tools";
import type {
	AgentTeamsRuntime,
	DelegatedAgentConfigProvider,
	TeamEvent,
} from "../extensions/tools/team";
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

export interface TeamToolsFactoryOptions {
	runtime: AgentTeamsRuntime;
	teammateConfigProvider: DelegatedAgentConfigProvider;
	createBaseTools?: () => Tool[];
	leadAgentId?: string;
	restoredTeammates?: TeamTeammateSpec[];
	restoredFromPersistence?: boolean;
	includeLeadSpawnTool?: boolean;
	includeLeadManagementTools?: boolean;
	onLeadToolsUnlocked?: (tools: Tool[]) => void;
}

export interface TeamToolsFactoryResult {
	tools: Tool[];
	restoredFromPersistence: boolean;
	restoredTeammates: string[];
}

export type TeamToolsFactory = (
	options: TeamToolsFactoryOptions,
) => TeamToolsFactoryResult;

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
	teamToolsFactory?: TeamToolsFactory;
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
