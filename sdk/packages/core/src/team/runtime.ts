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
	type AppendMissionLogInput,
	type AttachTeamOutcomeFragmentInput,
	type CreateTeamOutcomeInput,
	type CreateTeamTaskInput,
	createAgentTeam,
	createWorkerReviewerTeam,
	type MissionLogEntry,
	type MissionLogKind,
	type ReviewTeamOutcomeFragmentInput,
	type RouteToTeammateOptions,
	type SpawnTeammateOptions,
	type TaskResult,
	type TeamEvent,
	type TeamMailboxMessage,
	type TeamMemberConfig,
	type TeamMemberSnapshot,
	TeamMessageType,
	type TeammateLifecycleSpec,
	type TeamOutcome,
	type TeamOutcomeFragment,
	type TeamOutcomeFragmentStatus,
	type TeamOutcomeStatus,
	type TeamRunRecord,
	type TeamRunStatus,
	type TeamRuntimeSnapshot,
	type TeamRuntimeState,
	type TeamTask,
	type TeamTaskStatus,
} from "./multi-agent";
export type { TeamTeammateSpec } from "./schema";
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
