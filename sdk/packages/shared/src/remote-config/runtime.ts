import type { AgentExtension } from "../agents/types";
import {
	FileRemoteConfigBundleStore,
	FileSystemRemoteConfigManagedArtifactStore,
} from "./artifact-store";
import type {
	PreparedRemoteConfigRuntime,
	PrepareRemoteConfigRuntimeOptions,
	RemoteConfigBundle,
	RemoteConfigManagedArtifactStore,
	RemoteConfigPolicyMaterializer,
	RemoteConfigProjectContext,
	RemoteConfigSyncResult,
	RemoteConfigSyncServiceOptions,
} from "./bundle";
import { FileSystemRemoteConfigPolicyMaterializer } from "./materializer";
import {
	getRemoteConfigCommandDirectories,
	resolveRemoteConfigPaths,
} from "./paths";
import { DefaultRemoteConfigTelemetryAdapter } from "./telemetry";

function deriveClaims(
	bundle: RemoteConfigBundle | undefined,
): RemoteConfigSyncResult["claims"] {
	return bundle?.claims;
}

function deriveRoles(
	claims: RemoteConfigSyncResult["claims"],
	options: Pick<
		PrepareRemoteConfigRuntimeOptions | RemoteConfigSyncServiceOptions,
		"claimsMapper"
	>,
): string[] {
	if (!claims) {
		return [];
	}
	if (options.claimsMapper) {
		return options.claimsMapper.mapClaimsToRoles(claims);
	}
	return claims.roles ?? [];
}

export function withRemoteConfigBundlePaths<T extends RemoteConfigBundle>(
	bundle: T,
	paths: RemoteConfigSyncResult["materialized"]["paths"],
): T {
	return {
		...bundle,
		metadata: {
			...(bundle.metadata ?? {}),
			paths,
		},
	};
}

export class RemoteConfigSyncService {
	constructor(private readonly options: RemoteConfigSyncServiceOptions) {}

	async sync(input: {
		workspacePath: string;
		rootPath?: string;
		context?: RemoteConfigProjectContext;
		paths: RemoteConfigSyncResult["materialized"]["paths"];
		signal?: AbortSignal;
		now?: number;
	}): Promise<RemoteConfigSyncResult> {
		const bundle = await this.options.controlPlane.fetchBundle({
			workspacePath: input.workspacePath,
			rootPath: input.rootPath,
			context: input.context,
			signal: input.signal,
			now: input.now,
			logger: this.options.logger,
		});

		if (!bundle) {
			throw new Error("Remote config control plane returned no bundle");
		}

		await this.options.bundleStore.write(bundle);

		const materialized = await this.options.materializer.materialize({
			bundle,
			paths: input.paths,
			artifactStore: this.options.artifactStore,
		});

		const telemetry = this.options.telemetryAdapter
			? await this.options.telemetryAdapter.resolveTelemetry(bundle, {
					workspacePath: input.workspacePath,
					rootPath: input.rootPath,
					context: input.context,
					signal: input.signal,
					now: input.now,
					logger: this.options.logger,
				})
			: undefined;
		const claims = deriveClaims(bundle);
		const roles = deriveRoles(claims, this.options);

		return {
			bundle,
			materialized,
			telemetry,
			roles,
			claims,
		};
	}
}

export function createRemoteConfigPluginDefinition(options?: {
	name?: string;
	setup?: AgentExtension["setup"];
}): AgentExtension {
	const name = options?.name ?? "remote-config";
	return {
		name,
		manifest: { capabilities: ["providers"] },
		async setup(api, ctx) {
			api.registerProvider?.({
				name,
				description: "Remote-config managed runtime integration",
			});
			await options?.setup?.(api, ctx);
		},
	};
}

export async function prepareRemoteConfigRuntime(
	options: PrepareRemoteConfigRuntimeOptions,
): Promise<PreparedRemoteConfigRuntime> {
	const paths = resolveRemoteConfigPaths({
		workspacePath: options.workspacePath,
		pluginName: options.pluginName,
	});
	const bundleStore =
		options.bundleStore ??
		new FileRemoteConfigBundleStore(paths.bundleCachePath);
	const artifactStore: RemoteConfigManagedArtifactStore =
		options.artifactStore ?? new FileSystemRemoteConfigManagedArtifactStore();
	const materializer: RemoteConfigPolicyMaterializer =
		options.materializer ?? new FileSystemRemoteConfigPolicyMaterializer();
	const telemetryAdapter =
		options.telemetryAdapter ?? new DefaultRemoteConfigTelemetryAdapter();

	let bundle: RemoteConfigBundle | undefined;
	let telemetry: RemoteConfigSyncResult["telemetry"];
	let roles: string[] = [];
	let claims: RemoteConfigSyncResult["claims"];
	let usedCachedBundle = false;
	let bundleMaterializedDuringSync = false;

	if (options.controlPlane) {
		const syncService = new RemoteConfigSyncService({
			controlPlane: options.controlPlane,
			bundleStore,
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
		throw new Error("Remote config runtime preparation requires a bundle");
	}

	if (bundle) {
		const bundleWithPaths = withRemoteConfigBundlePaths(bundle, paths);
		await bundleStore.write(bundleWithPaths);
		if (!bundleMaterializedDuringSync) {
			await materializer.materialize({
				bundle: bundleWithPaths,
				paths,
				artifactStore,
			});
		}
		claims ??= deriveClaims(bundleWithPaths);
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

	const commandDirectories = getRemoteConfigCommandDirectories(paths);
	return {
		pluginName: paths.pluginName,
		pluginDefinition: createRemoteConfigPluginDefinition({
			name: paths.pluginName,
		}),
		paths,
		bundle,
		telemetry,
		roles,
		claims,
		usedCachedBundle,
		workflowsDirectories: commandDirectories.workflowsDirectories,
		skillsDirectories: commandDirectories.skillsDirectories,
	};
}
