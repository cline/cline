export {
	upsertWorkspaceInfo,
	type WorkspaceInfo,
	type WorkspaceManifest,
	WorkspaceManifestSchema,
} from "@clinebot/shared";
export type {
	ClineCore,
	ClineCoreOptions,
} from "../ClineCore";
export { DefaultSessionManager } from "./default-session-manager";
export { RpcCoreSessionService } from "./rpc-session-service";
export {
	deriveSubsessionStatus,
	makeSubSessionId,
	makeTeamTaskSubSessionId,
	sanitizeSessionToken,
} from "./session-graph";
export type {
	SessionBackend,
	SessionHost,
} from "./session-host";
export { createSessionHost, resolveSessionBackend } from "./session-host";
export type {
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionManager,
	StartSessionInput,
	StartSessionResult,
} from "./session-manager";
export type { SessionManifest } from "./session-manifest";
export type {
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
} from "./session-service";
export { CoreSessionService } from "./session-service";
export type {
	WorkspaceManager,
	WorkspaceManagerEvent,
} from "./workspace-manager";
export { InMemoryWorkspaceManager } from "./workspace-manager";
export {
	generateWorkspaceInfo,
	normalizeWorkspacePath,
} from "./workspace-manifest";
