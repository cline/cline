import type {
	AgentExtension,
	EnterpriseConfigBundle,
	EnterpriseManagedArtifactStore,
	EnterprisePolicyMaterializer,
	EnterpriseSyncResult,
	PreparedEnterpriseRuntime,
	PrepareEnterpriseRuntimeOptions,
} from "../contracts";
import {
	EnterpriseSyncService,
	withEnterpriseBundlePaths,
} from "../control-plane/service";
import { FileSystemEnterprisePolicyMaterializer } from "../materialization/materializer";
import {
	getEnterpriseCommandDirectories,
	resolveEnterprisePaths,
} from "../materialization/paths";
import {
	FileEnterpriseBundleStore,
	FileEnterpriseTokenStore,
	FileSystemEnterpriseManagedArtifactStore,
} from "../storage";
import { RemoteConfigEnterpriseTelemetryAdapter } from "../telemetry/remote-config";

function deriveClaims(
	bundle: EnterpriseConfigBundle | undefined,
	identity: EnterpriseSyncResult["identity"],
): EnterpriseSyncResult["claims"] {
	return bundle?.claims ?? identity?.claims;
}

function deriveRoles(
	claims: EnterpriseSyncResult["claims"],
	options: PrepareEnterpriseRuntimeOptions,
): string[] {
	if (!claims) {
		return [];
	}
	if (options.claimsMapper) {
		return options.claimsMapper.mapClaimsToRoles(claims);
	}
	return claims.roles ?? [];
}

export function createEnterprisePluginDefinition(options?: {
	name?: string;
	setup?: AgentExtension["setup"];
}): AgentExtension {
	const name = options?.name ?? "enterprise";
	return {
		name,
		manifest: { capabilities: ["providers"] },
		async setup(api, ctx) {
			api.registerProvider?.({
				name,
				description: "Enterprise-managed runtime integration",
			});
			await options?.setup?.(api, ctx);
		},
	};
}

export async function prepareEnterpriseRuntime(
	options: PrepareEnterpriseRuntimeOptions,
): Promise<PreparedEnterpriseRuntime> {
	const paths = resolveEnterprisePaths({
		workspacePath: options.workspacePath,
		pluginName: options.pluginName,
	});
	const bundleStore =
		options.bundleStore ?? new FileEnterpriseBundleStore(paths.bundleCachePath);
	const tokenStore =
		options.tokenStore ?? new FileEnterpriseTokenStore(paths.tokenCachePath);
	const artifactStore: EnterpriseManagedArtifactStore =
		options.artifactStore ?? new FileSystemEnterpriseManagedArtifactStore();
	const materializer: EnterprisePolicyMaterializer =
		options.materializer ?? new FileSystemEnterprisePolicyMaterializer();
	const telemetryAdapter =
		options.telemetryAdapter ?? new RemoteConfigEnterpriseTelemetryAdapter();

	let bundle: EnterpriseConfigBundle | undefined;
	let identity: EnterpriseSyncResult["identity"];
	let telemetry: EnterpriseSyncResult["telemetry"];
	let roles: string[] = [];
	let claims: EnterpriseSyncResult["claims"];
	let usedCachedBundle = false;
	let bundleMaterializedDuringSync = false;

	if (options.controlPlane) {
		const syncService = new EnterpriseSyncService({
			identity: options.identity,
			controlPlane: options.controlPlane,
			bundleStore,
			tokenStore,
			artifactStore,
			materializer,
			telemetryAdapter,
			claimsMapper: options.claimsMapper,
			logger: options.logger,
		});

		try {
			const result = await syncService.sync({
				workspacePath: options.workspacePath,
				rootPath: options.rootPath,
				context: options.context,
				paths,
				signal: options.signal,
				now: options.now,
			});
			bundle = result.bundle;
			identity = result.identity;
			telemetry = result.telemetry;
			roles = result.roles;
			claims = result.claims;
			bundleMaterializedDuringSync = true;
		} catch (error) {
			if (options.useCachedBundle !== false) {
				bundle = await bundleStore.read();
				usedCachedBundle = Boolean(bundle);
			}
			if (!bundle) {
				throw error;
			}
		}
	} else if (options.useCachedBundle !== false) {
		bundle = await bundleStore.read();
		usedCachedBundle = Boolean(bundle);
	}

	if (!bundle && options.requireBundle) {
		throw new Error("Enterprise runtime preparation requires a bundle");
	}

	if (bundle) {
		const bundleWithPaths = withEnterpriseBundlePaths(bundle, paths);
		await bundleStore.write(bundleWithPaths);
		if (!bundleMaterializedDuringSync) {
			await materializer.materialize({
				bundle: bundleWithPaths,
				paths,
				artifactStore,
			});
		}
		claims ??= deriveClaims(bundleWithPaths, identity);
		roles = roles.length > 0 ? roles : deriveRoles(claims, options);
		telemetry ??= await telemetryAdapter.resolveTelemetry(bundleWithPaths, {
			workspacePath: options.workspacePath,
			rootPath: options.rootPath,
			context: options.context,
			signal: options.signal,
			now: options.now,
			logger: options.logger,
		});
		bundle = bundleWithPaths;
	}

	const commandDirectories = getEnterpriseCommandDirectories(paths);
	return {
		pluginName: paths.pluginName,
		pluginDefinition: createEnterprisePluginDefinition({
			name: paths.pluginName,
		}),
		paths,
		bundle,
		identity,
		telemetry,
		roles,
		claims,
		usedCachedBundle,
		workflowsDirectories: commandDirectories.workflowsDirectories,
		skillsDirectories: commandDirectories.skillsDirectories,
	};
}
