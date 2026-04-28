import type {
	AgentConfig,
	AgentHooks,
	AgentResult,
	BasicLogger,
	ITelemetryService,
	RuntimeConfigExtensionKind,
	Tool,
} from "@clinebot/shared";
import type { UserInstructionConfigWatcher } from "../../extensions/config";
import type { ToolExecutors } from "../../extensions/tools";
import type {
	AgentTeamsRuntime,
	DelegatedAgentConfigProvider,
	TeamEvent,
} from "../../extensions/tools/team";
import type { CoreSessionConfig } from "../../types/config";

/**
 * Internal structural alias for the lead-agent handle that
 * {@link BuiltRuntime.registerLeadAgent} hands off to
 * `runtime-builder.ts`. Narrowed to only the `.addTools()` surface the
 * callback exercises; avoids depending on `@clinebot/agents`' `Agent`
 * class during the PLAN.md §3.6 Step 5 type-only migration. When
 * SessionRuntime is rebuilt in Step 6, this field is expected to be
 * dropped entirely per §3.5 row #2.
 */
type LeadAgentHandle = {
	addTools(tools: Tool[]): unknown;
};

export interface BuiltRuntime {
	tools: Tool[];
	hooks?: AgentHooks;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	teamRuntime?: AgentTeamsRuntime;
	teamRestoredFromPersistence?: boolean;
	delegatedAgentConfigProvider?: DelegatedAgentConfigProvider;
	completionGuard?: () => string | undefined;
	registerLeadAgent?: (agent: LeadAgentHandle) => void;
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
	configExtensions?: RuntimeConfigExtensionKind[];
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
