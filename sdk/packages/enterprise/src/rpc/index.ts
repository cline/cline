import type {
	EnterpriseAuthenticateRequest,
	EnterpriseAuthenticateResponse,
	EnterpriseStatusRequest,
	EnterpriseStatusResponse,
	EnterpriseSyncRequest,
	EnterpriseSyncResponse,
} from "@clinebot/shared";
import { EnterpriseAuthService } from "../auth/service";
import type {
	EnterpriseClaimsMapper,
	EnterpriseConfigBundle,
	PrepareEnterpriseRuntimeOptions,
} from "../contracts";
import { resolveEnterprisePaths } from "../materialization/paths";
import { prepareEnterpriseRuntime } from "../runtime/prepare";
import {
	FileEnterpriseBundleStore,
	FileEnterpriseTokenStore,
	FileSystemEnterpriseManagedArtifactStore,
} from "../storage";
import { RemoteConfigEnterpriseTelemetryAdapter } from "../telemetry/remote-config";

export interface EnterpriseRpcHandlers {
	enterpriseAuthenticate(
		request: EnterpriseAuthenticateRequest,
	): Promise<EnterpriseAuthenticateResponse>;
	enterpriseSync(
		request: EnterpriseSyncRequest,
	): Promise<EnterpriseSyncResponse>;
	enterpriseGetStatus(
		request: EnterpriseStatusRequest,
	): Promise<EnterpriseStatusResponse>;
}

export interface CreateEnterpriseRpcHandlersOptions
	extends Omit<
		PrepareEnterpriseRuntimeOptions,
		"workspacePath" | "rootPath" | "context" | "useCachedBundle"
	> {
	providerId?: string;
}

function resolveConfiguredProviderId(
	options: CreateEnterpriseRpcHandlersOptions,
): string {
	return (
		options.providerId ??
		options.controlPlane?.name ??
		options.identity?.name ??
		"enterprise"
	);
}

function assertProviderId(
	requestProviderId: string,
	options: CreateEnterpriseRpcHandlersOptions,
): void {
	const expectedProviderId = resolveConfiguredProviderId(options);
	if (requestProviderId.trim() !== expectedProviderId) {
		throw new Error(
			`Unsupported enterprise provider "${requestProviderId}". Expected "${expectedProviderId}".`,
		);
	}
}

function countBundleInstructions(bundle: EnterpriseConfigBundle | undefined): {
	rulesCount: number;
	workflowsCount: number;
	skillsCount: number;
} {
	const remoteRules = bundle?.remoteConfig?.globalRules?.length ?? 0;
	const remoteWorkflows = bundle?.remoteConfig?.globalWorkflows?.length ?? 0;
	const managedInstructions = bundle?.managedInstructions ?? [];
	return {
		rulesCount:
			remoteRules +
			managedInstructions.filter((item) => item.kind === "rule").length,
		workflowsCount:
			remoteWorkflows +
			managedInstructions.filter((item) => item.kind === "workflow").length,
		skillsCount: managedInstructions.filter((item) => item.kind === "skill")
			.length,
	};
}

function mapRoles(
	claims: EnterpriseAuthenticateResponse["claims"],
	claimsMapper?: EnterpriseClaimsMapper,
): string[] {
	if (!claims) {
		return [];
	}
	if (claimsMapper) {
		return claimsMapper.mapClaimsToRoles(claims as never);
	}
	const roles = claims.roles;
	return Array.isArray(roles)
		? roles.filter((role): role is string => typeof role === "string")
		: [];
}

function toRecord(
	value: EnterpriseConfigBundle["claims"] | Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	return value ? ({ ...value } as Record<string, unknown>) : undefined;
}

function createRequestOptions(
	request:
		| EnterpriseAuthenticateRequest
		| EnterpriseSyncRequest
		| EnterpriseStatusRequest,
	options: CreateEnterpriseRpcHandlersOptions,
) {
	const paths = resolveEnterprisePaths({
		workspacePath: request.workspacePath,
		pluginName: options.pluginName,
	});
	return {
		paths,
		bundleStore:
			options.bundleStore ??
			new FileEnterpriseBundleStore(paths.bundleCachePath),
		tokenStore:
			options.tokenStore ?? new FileEnterpriseTokenStore(paths.tokenCachePath),
		artifactStore:
			options.artifactStore ?? new FileSystemEnterpriseManagedArtifactStore(),
		telemetryAdapter:
			options.telemetryAdapter ?? new RemoteConfigEnterpriseTelemetryAdapter(),
		context: {
			projectId:
				"projectId" in request ? (request.projectId ?? undefined) : undefined,
			workspaceId:
				"workspaceId" in request
					? (request.workspaceId ?? undefined)
					: undefined,
			organizationId:
				"organizationId" in request
					? (request.organizationId ?? undefined)
					: undefined,
		},
	};
}

export function createEnterpriseRpcHandlers(
	options: CreateEnterpriseRpcHandlersOptions,
): EnterpriseRpcHandlers {
	const providerId = resolveConfiguredProviderId(options);
	return {
		async enterpriseAuthenticate(
			request: EnterpriseAuthenticateRequest,
		): Promise<EnterpriseAuthenticateResponse> {
			assertProviderId(request.providerId, options);
			if (!options.identity) {
				throw new Error("enterprise identity adapter is not configured");
			}
			const { tokenStore, context } = createRequestOptions(request, options);
			const authService = new EnterpriseAuthService({
				identity: options.identity,
				tokenStore,
			});
			const identity = await authService.resolveIdentity({
				workspacePath: request.workspacePath,
				rootPath: request.rootPath,
				context,
				logger: options.logger,
			});
			return {
				providerId,
				authenticated: Boolean(identity),
				roles: mapRoles(toRecord(identity?.claims), options.claimsMapper),
				claims: toRecord(identity?.claims),
				metadata: identity?.metadata,
			};
		},
		async enterpriseSync(
			request: EnterpriseSyncRequest,
		): Promise<EnterpriseSyncResponse> {
			assertProviderId(request.providerId, options);
			const prepared = await prepareEnterpriseRuntime({
				...options,
				workspacePath: request.workspacePath,
				rootPath: request.rootPath,
				context: createRequestOptions(request, options).context,
				useCachedBundle: request.useCachedBundle,
				requireBundle: true,
			});
			const counts = countBundleInstructions(prepared.bundle);
			return {
				providerId,
				authenticated: Boolean(prepared.identity),
				hasCachedBundle: prepared.usedCachedBundle,
				appliedConfigVersion: prepared.bundle?.version,
				roles: prepared.roles,
				hasTelemetryOverrides: Boolean(prepared.telemetry),
				rulesCount: counts.rulesCount,
				workflowsCount: counts.workflowsCount,
				skillsCount: counts.skillsCount,
				claims: toRecord(prepared.claims),
				metadata: prepared.bundle?.metadata,
			};
		},
		async enterpriseGetStatus(
			request: EnterpriseStatusRequest,
		): Promise<EnterpriseStatusResponse> {
			assertProviderId(request.providerId, options);
			const { bundleStore, tokenStore, telemetryAdapter } =
				createRequestOptions(request, options);
			const bundle = await bundleStore.read();
			const token = await tokenStore.read();
			const telemetry = bundle
				? await telemetryAdapter.resolveTelemetry(bundle, {
						workspacePath: request.workspacePath,
						rootPath: request.rootPath,
						logger: options.logger,
					})
				: undefined;
			const counts = countBundleInstructions(bundle);
			const claims = bundle?.claims;
			return {
				providerId,
				authenticated: Boolean(token || claims),
				hasCachedBundle: Boolean(bundle),
				appliedConfigVersion: bundle?.version,
				roles: mapRoles(toRecord(claims), options.claimsMapper),
				hasTelemetryOverrides: Boolean(telemetry),
				rulesCount: counts.rulesCount,
				workflowsCount: counts.workflowsCount,
				skillsCount: counts.skillsCount,
				claims: toRecord(claims),
				metadata: bundle?.metadata,
			};
		},
	};
}
