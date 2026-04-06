import type { AgentExtension } from "@clinebot/agents";
import type {
	CreateOpenTelemetryTelemetryServiceOptions,
	StartSessionInput,
} from "@clinebot/core";
import type {
	BasicLogger,
	ITelemetryService,
	OpenTelemetryClientConfig,
	RemoteConfig,
} from "@clinebot/shared";

export type { AgentExtension };

export interface EnterpriseIdentityClaims {
	subject: string;
	email?: string;
	roles?: string[];
	groups?: string[];
	organizationId?: string;
	projectIds?: string[];
	rawClaims?: Record<string, unknown>;
}

export interface EnterpriseAccessToken {
	accessToken: string;
	idToken?: string;
	refreshToken?: string;
	expiresAt?: number;
	scopes?: string[];
}

export interface EnterpriseProjectContext {
	projectId?: string;
	workspaceId?: string;
	organizationId?: string;
}

export type EnterpriseRuleKind = "rule" | "workflow" | "skill";

export interface EnterpriseRuleFile {
	id: string;
	name: string;
	kind: EnterpriseRuleKind;
	contents: string;
	alwaysEnabled?: boolean;
	description?: string;
	metadata?: Record<string, unknown>;
}

export interface EnterpriseConfigBundle {
	source: string;
	version: string;
	remoteConfig?: RemoteConfig;
	managedInstructions?: EnterpriseRuleFile[];
	telemetry?: Record<string, unknown>;
	claims?: EnterpriseIdentityClaims;
	metadata?: Record<string, unknown>;
}

export interface EnterpriseIdentitySession {
	token?: EnterpriseAccessToken;
	claims: EnterpriseIdentityClaims;
	context?: EnterpriseProjectContext;
	metadata?: Record<string, unknown>;
}

export interface EnterpriseSyncContext {
	workspacePath: string;
	rootPath?: string;
	context?: EnterpriseProjectContext;
	logger?: BasicLogger;
	signal?: AbortSignal;
	now?: number;
}

export interface IdentityResolveInput extends EnterpriseSyncContext {}

export interface IdentityAdapter {
	name: string;
	resolveIdentity(
		input: IdentityResolveInput,
	): Promise<EnterpriseIdentitySession | undefined>;
}

export interface EnterpriseControlPlaneFetchInput
	extends EnterpriseSyncContext {
	identity?: EnterpriseIdentitySession;
}

export interface EnterpriseControlPlane {
	name: string;
	fetchBundle(
		input: EnterpriseControlPlaneFetchInput,
	): Promise<EnterpriseConfigBundle | undefined>;
}

export interface EnterpriseClaimsMapper<TRole extends string = string> {
	mapClaimsToRoles(claims: EnterpriseIdentityClaims): TRole[];
}

export interface EnterpriseBundleStore {
	read(): Promise<EnterpriseConfigBundle | undefined>;
	write(bundle: EnterpriseConfigBundle): Promise<void>;
	clear(): Promise<void>;
}

export interface EnterpriseTokenStore {
	read(): Promise<EnterpriseAccessToken | undefined>;
	write(token: EnterpriseAccessToken): Promise<void>;
	clear(): Promise<void>;
}

export interface EnterpriseManagedArtifactStore {
	writeText(filePath: string, contents: string): Promise<void>;
	remove(targetPath: string): Promise<void>;
	removeChildren(directoryPath: string): Promise<void>;
}

export interface EnterprisePaths {
	pluginName: string;
	pluginPath: string;
	workflowsPath: string;
	skillsPath: string;
	bundleCachePath: string;
	tokenCachePath: string;
	manifestPath: string;
	rulesFilePath: string;
}

export interface EnterpriseMaterializationInput {
	bundle: EnterpriseConfigBundle;
	paths: EnterprisePaths;
	artifactStore: EnterpriseManagedArtifactStore;
}

export interface MaterializedInstructionFile {
	kind: EnterpriseRuleKind;
	filePath: string;
	id: string;
	name: string;
}

export interface EnterpriseMaterializationResult {
	paths: EnterprisePaths;
	rulesFilePath?: string;
	files: MaterializedInstructionFile[];
}

export interface EnterprisePolicyMaterializer {
	materialize(
		input: EnterpriseMaterializationInput,
	): Promise<EnterpriseMaterializationResult>;
}

export interface EnterpriseTelemetryAdapter {
	name: string;
	resolveTelemetry(
		bundle: EnterpriseConfigBundle,
		context: EnterpriseSyncContext,
	):
		| Promise<Partial<OpenTelemetryClientConfig> | undefined>
		| Partial<OpenTelemetryClientConfig>
		| undefined;
}

export interface EnterpriseAuthServiceOptions {
	identity: IdentityAdapter;
	tokenStore?: EnterpriseTokenStore;
}

export interface EnterpriseSyncServiceOptions {
	identity?: IdentityAdapter;
	controlPlane: EnterpriseControlPlane;
	bundleStore: EnterpriseBundleStore;
	materializer: EnterprisePolicyMaterializer;
	artifactStore: EnterpriseManagedArtifactStore;
	telemetryAdapter?: EnterpriseTelemetryAdapter;
	claimsMapper?: EnterpriseClaimsMapper;
	tokenStore?: EnterpriseTokenStore;
	logger?: BasicLogger;
}

export interface EnterpriseSyncResult {
	identity?: EnterpriseIdentitySession;
	bundle: EnterpriseConfigBundle;
	materialized: EnterpriseMaterializationResult;
	telemetry?: Partial<OpenTelemetryClientConfig>;
	roles: string[];
	claims?: EnterpriseIdentityClaims;
}

export interface PrepareEnterpriseRuntimeOptions extends EnterpriseSyncContext {
	pluginName?: string;
	identity?: IdentityAdapter;
	controlPlane?: EnterpriseControlPlane;
	bundleStore?: EnterpriseBundleStore;
	tokenStore?: EnterpriseTokenStore;
	artifactStore?: EnterpriseManagedArtifactStore;
	materializer?: EnterprisePolicyMaterializer;
	telemetryAdapter?: EnterpriseTelemetryAdapter;
	claimsMapper?: EnterpriseClaimsMapper;
	useCachedBundle?: boolean;
	requireBundle?: boolean;
}

export interface PreparedEnterpriseRuntime {
	pluginName: string;
	pluginDefinition: AgentExtension;
	paths: EnterprisePaths;
	bundle?: EnterpriseConfigBundle;
	identity?: EnterpriseIdentitySession;
	telemetry?: Partial<OpenTelemetryClientConfig>;
	roles: string[];
	claims?: EnterpriseIdentityClaims;
	usedCachedBundle: boolean;
	workflowsDirectories: readonly string[];
	skillsDirectories: readonly string[];
}

export interface CreateEnterprisePluginOptions
	extends PrepareEnterpriseRuntimeOptions {
	syncOnSetup?: boolean;
}

export interface PrepareEnterpriseCoreIntegrationOptions
	extends PrepareEnterpriseRuntimeOptions {
	telemetryService?: Omit<
		CreateOpenTelemetryTelemetryServiceOptions,
		keyof OpenTelemetryClientConfig
	>;
}

export interface PreparedEnterpriseCoreIntegration {
	prepared: PreparedEnterpriseRuntime;
	extensions: NonNullable<StartSessionInput["config"]["extensions"]>;
	telemetry?: ITelemetryService;
	applyToStartSessionInput(input: StartSessionInput): StartSessionInput;
	dispose(): Promise<void>;
}
