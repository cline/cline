import type { AgentExtension } from "../agents/types";
import type { BasicLogger } from "../logging/logger";
import type { OpenTelemetryClientConfig } from "../services/telemetry";
import type { GlobalInstructionsFile, RemoteConfig } from "./schema";

export interface RemoteConfigIdentityClaims {
	subject: string;
	email?: string;
	roles?: string[];
	groups?: string[];
	organizationId?: string;
	projectIds?: string[];
	rawClaims?: Record<string, unknown>;
}

export type RemoteConfigManagedInstructionKind = "rule" | "workflow" | "skill";

export interface RemoteConfigManagedInstructionFile {
	id: string;
	name: string;
	kind: RemoteConfigManagedInstructionKind;
	contents: string;
	alwaysEnabled?: boolean;
	description?: string;
	metadata?: Record<string, unknown>;
}

export interface RemoteConfigBundle {
	source: string;
	version: string;
	remoteConfig?: RemoteConfig;
	managedInstructions?: RemoteConfigManagedInstructionFile[];
	telemetry?: Record<string, unknown>;
	claims?: RemoteConfigIdentityClaims;
	metadata?: Record<string, unknown>;
}

export interface RemoteConfigProjectContext {
	projectId?: string;
	workspaceId?: string;
	organizationId?: string;
}

export interface RemoteConfigSyncContext {
	workspacePath: string;
	rootPath?: string;
	context?: RemoteConfigProjectContext;
	logger?: BasicLogger;
	signal?: AbortSignal;
	now?: number;
}

export interface RemoteConfigControlPlaneFetchInput
	extends RemoteConfigSyncContext {}

export interface RemoteConfigControlPlane {
	name: string;
	fetchBundle(
		input: RemoteConfigControlPlaneFetchInput,
	): Promise<RemoteConfigBundle | undefined>;
}

export interface RemoteConfigBundleStore {
	read(): Promise<RemoteConfigBundle | undefined>;
	write(bundle: RemoteConfigBundle): Promise<void>;
	clear(): Promise<void>;
}

export interface RemoteConfigManagedArtifactStore {
	writeText(filePath: string, contents: string): Promise<void>;
	remove(targetPath: string): Promise<void>;
	removeChildren(directoryPath: string): Promise<void>;
}

export interface RemoteConfigManagedPaths {
	pluginName: string;
	pluginPath: string;
	workflowsPath: string;
	skillsPath: string;
	bundleCachePath: string;
	manifestPath: string;
	rulesFilePath: string;
}

export interface RemoteConfigMaterializationInput {
	bundle: RemoteConfigBundle;
	paths: RemoteConfigManagedPaths;
	artifactStore: RemoteConfigManagedArtifactStore;
}

export interface RemoteConfigMaterializedInstructionFile {
	kind: RemoteConfigManagedInstructionKind;
	filePath: string;
	id: string;
	name: string;
}

export interface RemoteConfigMaterializationResult {
	paths: RemoteConfigManagedPaths;
	rulesFilePath?: string;
	files: RemoteConfigMaterializedInstructionFile[];
}

export interface RemoteConfigPolicyMaterializer {
	materialize(
		input: RemoteConfigMaterializationInput,
	): Promise<RemoteConfigMaterializationResult>;
}

export interface RemoteConfigTelemetryAdapter {
	name: string;
	resolveTelemetry(
		bundle: RemoteConfigBundle,
		context: RemoteConfigSyncContext,
	):
		| Promise<Partial<OpenTelemetryClientConfig> | undefined>
		| Partial<OpenTelemetryClientConfig>
		| undefined;
}

export interface RemoteConfigClaimsMapper<TRole extends string = string> {
	mapClaimsToRoles(claims: RemoteConfigIdentityClaims): TRole[];
}

export interface RemoteConfigSyncServiceOptions {
	controlPlane: RemoteConfigControlPlane;
	bundleStore: RemoteConfigBundleStore;
	materializer: RemoteConfigPolicyMaterializer;
	artifactStore: RemoteConfigManagedArtifactStore;
	telemetryAdapter?: RemoteConfigTelemetryAdapter;
	claimsMapper?: RemoteConfigClaimsMapper;
	logger?: BasicLogger;
}

export interface RemoteConfigSyncResult {
	bundle: RemoteConfigBundle;
	materialized: RemoteConfigMaterializationResult;
	telemetry?: Partial<OpenTelemetryClientConfig>;
	roles: string[];
	claims?: RemoteConfigIdentityClaims;
}

export interface PrepareRemoteConfigRuntimeOptions
	extends RemoteConfigSyncContext {
	pluginName?: string;
	controlPlane?: RemoteConfigControlPlane;
	bundleStore?: RemoteConfigBundleStore;
	artifactStore?: RemoteConfigManagedArtifactStore;
	materializer?: RemoteConfigPolicyMaterializer;
	telemetryAdapter?: RemoteConfigTelemetryAdapter;
	claimsMapper?: RemoteConfigClaimsMapper;
	useCachedBundle?: boolean;
	requireBundle?: boolean;
}

export interface PreparedRemoteConfigRuntime {
	pluginName: string;
	pluginDefinition: AgentExtension;
	paths: RemoteConfigManagedPaths;
	bundle?: RemoteConfigBundle;
	telemetry?: Partial<OpenTelemetryClientConfig>;
	roles: string[];
	claims?: RemoteConfigIdentityClaims;
	usedCachedBundle: boolean;
	workflowsDirectories: readonly string[];
	skillsDirectories: readonly string[];
}

export function remoteConfigInstructionToManagedFile(
	kind: Extract<RemoteConfigManagedInstructionKind, "rule" | "workflow">,
	file: GlobalInstructionsFile,
	suffix: string,
): RemoteConfigManagedInstructionFile {
	return {
		id: `remote-config:${kind}:${suffix}:${file.name}`,
		name: file.name,
		kind,
		contents: file.contents,
		alwaysEnabled: file.alwaysEnabled,
	};
}
