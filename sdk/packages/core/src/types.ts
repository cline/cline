import type * as LlmsProviders from "@clinebot/llms/providers";
import type { CoreSessionEvent } from "./types/events";

export type {
	AgentConfigWatcher,
	AgentConfigWatcherEvent,
	AgentYamlConfig,
	BuildAgentConfigOverridesOptions,
	CreateAgentConfigWatcherOptions,
	CreateInstructionWatcherOptions,
	CreateRulesConfigDefinitionOptions,
	CreateSkillsConfigDefinitionOptions,
	CreateUserInstructionConfigWatcherOptions,
	CreateWorkflowsConfigDefinitionOptions,
	LoadAgentPluginFromPathOptions,
	ParseMarkdownFrontmatterResult,
	ParseYamlFrontmatterResult,
	ResolveAgentPluginPathsOptions,
	RuleConfig,
	SkillConfig,
	UnifiedConfigDefinition,
	UnifiedConfigFileCandidate,
	UnifiedConfigFileContext,
	UnifiedConfigRecord,
	UnifiedConfigWatcherEvent,
	UnifiedConfigWatcherOptions,
	UserInstructionConfig,
	UserInstructionConfigType,
	UserInstructionConfigWatcher,
	UserInstructionConfigWatcherEvent,
	WorkflowConfig,
} from "./agents";
export {
	createAgentConfigDefinition,
	createAgentConfigWatcher,
	createRulesConfigDefinition,
	createSkillsConfigDefinition,
	createUserInstructionConfigWatcher,
	createWorkflowsConfigDefinition,
	discoverPluginModulePaths,
	loadAgentPluginFromPath,
	loadAgentPluginsFromPaths,
	parseAgentConfigFromYaml,
	parsePartialAgentConfigFromYaml,
	parseRuleConfigFromMarkdown,
	parseSkillConfigFromMarkdown,
	parseWorkflowConfigFromMarkdown,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentPluginPaths,
	resolveAgentTools,
	resolveAndLoadAgentPlugins,
	resolveDocumentsRulesDirectoryPath,
	resolveDocumentsWorkflowsDirectoryPath,
	resolvePluginConfigSearchPaths,
	resolveRulesConfigSearchPaths,
	resolveSkillsConfigSearchPaths,
	resolveWorkflowsConfigSearchPaths,
	SKILLS_CONFIG_DIRECTORY_NAME,
	toPartialAgentConfig,
	UnifiedConfigFileWatcher,
	WORKFLOWS_CONFIG_DIRECTORY_NAME,
} from "./agents";
export type {
	ChatMessage,
	ChatSessionConfig,
	ChatSessionStatus,
	ChatSummary,
	ChatViewState,
} from "./chat/chat-schema";
export type {
	SandboxCallOptions,
	SubprocessSandboxOptions,
} from "./runtime/sandbox/subprocess-sandbox";
export { SubprocessSandbox } from "./runtime/sandbox/subprocess-sandbox";
export type {
	BuiltRuntime as RuntimeEnvironment,
	RuntimeBuilder,
	RuntimeBuilderInput,
	SessionRuntime,
} from "./runtime/session-runtime";
export type {
	CreateSessionHostOptions,
	SessionHost,
} from "./session/session-host";
export type {
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionManager,
	StartSessionInput,
	StartSessionResult,
} from "./session/session-manager";
export type { SessionManifest } from "./session/session-manifest";
export type {
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
} from "./session/session-service";
export type {
	WorkspaceManager,
	WorkspaceManagerEvent,
} from "./session/workspace-manager";
export type { WorkspaceManifest } from "./session/workspace-manifest";
export type { SessionSource, SessionStatus } from "./types/common";
export type {
	CoreAgentMode,
	CoreModelConfig,
	CoreRuntimeFeatures,
	CoreSessionConfig,
} from "./types/config";
export type {
	CoreSessionEvent,
	SessionChunkEvent,
	SessionEndedEvent,
	SessionTeamProgressEvent,
	SessionToolEvent,
} from "./types/events";
export type { SessionRecord, SessionRef } from "./types/sessions";
export type { ArtifactStore, SessionStore, TeamStore } from "./types/storage";
export type { WorkspaceInfo } from "./types/workspace";

// Backward-compat alias used by CLI persistence.
export interface StoredMessages {
	version: 1;
	updatedAt: string;
	messages: LlmsProviders.MessageWithMetadata[];
}

// Backward-compat alias with previous event naming.
export type SessionEvent = CoreSessionEvent;
