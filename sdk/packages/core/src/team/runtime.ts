export {
	buildDelegatedAgentConfig,
	createDelegatedAgent,
	createDelegatedAgentConfigProvider,
	type DelegatedAgentConfigProvider,
	type DelegatedAgentConnectionConfig,
	type DelegatedAgentKind,
	type DelegatedAgentRuntimeConfig,
} from "./delegated-agent";

// =============================================================================
// Spawn Agent Tool
// =============================================================================

export {
	createSpawnAgentTool,
	type SpawnAgentInput,
	type SpawnAgentOutput,
	type SpawnAgentToolConfig,
	type SubAgentEndContext,
	type SubAgentStartContext,
} from "./spawn-agent-tool";

// =============================================================================
// Multi-Agent
// =============================================================================

export {
	type AgentTask,
	AgentTeam,
	AgentTeamsRuntime,
	type AgentTeamsRuntimeOptions,
	createAgentTeam,
	createWorkerReviewerTeam,
	type SpawnTeammateOptions,
	type TaskResult,
	type TeamEvent,
	type TeamMemberConfig,
} from "./multi-agent";

// =============================================================================
// Team Tools
// =============================================================================

export {
	type BootstrapAgentTeamsOptions,
	type BootstrapAgentTeamsResult,
	bootstrapAgentTeams,
	type CreateAgentTeamsToolsOptions,
	createAgentTeamsTools,
	reviveTeamStateDates,
	sanitizeTeamName,
	type TeamTeammateRuntimeConfig,
} from "./team-tools";
