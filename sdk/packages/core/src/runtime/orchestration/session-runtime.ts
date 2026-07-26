import type {
	AgentConfig,
	AgentEvent,
	AgentHooks,
	AgentResult,
	AgentTool,
	BasicLogger,
	CreateTeamTaskInput,
	RuntimeConfigExtensionKind,
	TeamBoardSnapshot,
	TeamRunRecord,
	TeamTask,
	ToolApprovalRequest,
	ToolApprovalResult,
	UpdateTeamTaskInput,
} from "@bedrock-coder/shared";
import type { UserInstructionConfigService } from "../../extensions/config";
import type { ToolExecutors } from "../../extensions/tools";
import type {
	AgentTeamsRuntime,
	DelegatedAgentConfigProvider,
	SubAgentEndContext,
	SubAgentStartContext,
	TeamEvent,
} from "../../extensions/tools/team";
import type { WorkspaceManager } from "../../services/workspace/workspace-manager";
import type { CoreSessionConfig } from "../../types/config";

/**
 * Internal structural alias for the lead-agent handle that
 * {@link BuiltRuntime.registerLeadAgent} hands off to
 * `runtime-builder.ts`. Narrowed to only the `.addTools()` surface the
 * callback exercises; avoids depending on `@bedrock-coder/agents`' `Agent`
 * class during the PLAN.md §3.6 Step 5 type-only migration. When
 * SessionRuntime is rebuilt in Step 6, this field is expected to be
 * dropped entirely per §3.5 row #2.
 */
type LeadAgentHandle = {
	addTools(tools: AgentTool[]): unknown;
};

export interface BuiltRuntime {
	tools: AgentTool[];
	hooks?: AgentHooks;
	logger?: BasicLogger;
	teamRuntime?: AgentTeamsRuntime;
	teamRestoredFromPersistence?: boolean;
	delegatedAgentConfigProvider?: DelegatedAgentConfigProvider;
	extensions?: AgentConfig["extensions"];
	completionPolicy?: AgentConfig["completionPolicy"];
	registerLeadAgent?: (agent: LeadAgentHandle) => void;
	shutdown: (reason: string) => Promise<void> | void;
}

export interface RuntimeBuilderInput {
	config: CoreSessionConfig;
	hooks?: AgentHooks;
	extensions?: AgentConfig["extensions"];
	onTeamEvent?: (event: TeamEvent) => void;
	onSubAgentEvent?: (event: AgentEvent) => void;
	onSubAgentStart?: (context: SubAgentStartContext) => void | Promise<void>;
	onSubAgentEnd?: (context: SubAgentEndContext) => void | Promise<void>;
	createSpawnTool?: () => AgentTool;
	onTeamRestored?: () => void;
	userInstructionService?: UserInstructionConfigService;
	pluginSkillDirectories?: ReadonlyArray<string>;
	configExtensions?: RuntimeConfigExtensionKind[];
	toolExecutors?: Partial<ToolExecutors>;
	toolPolicies?: CoreSessionConfig["toolPolicies"];
	workspaceManager?: WorkspaceManager;
	logger?: BasicLogger;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult> | ToolApprovalResult;
}

export interface RuntimeBuilder {
	build(input: RuntimeBuilderInput): Promise<BuiltRuntime> | BuiltRuntime;
}

export interface TeamRuntimeService {
	getTeamBoard(sessionId: string): TeamBoardSnapshot | undefined;
	createTeamTask(
		sessionId: string,
		input: Omit<CreateTeamTaskInput, "createdBy">,
	): TeamTask;
	updateTeamTask(sessionId: string, input: UpdateTeamTaskInput): TeamTask;
	cancelTeamRun(
		sessionId: string,
		runId: string,
		reason?: string,
	): TeamRunRecord;
}

export interface SessionRuntime {
	start(config: CoreSessionConfig): Promise<{ sessionId: string }>;
	send(sessionId: string, prompt: string): Promise<AgentResult | undefined>;
	abort(sessionId: string, reason?: unknown): Promise<void>;
	stop(sessionId: string): Promise<void>;
	poll(): Promise<string[]>;
}
