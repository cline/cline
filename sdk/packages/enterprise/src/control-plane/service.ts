import { EnterpriseAuthService } from "../auth/service";
import type {
	EnterpriseConfigBundle,
	EnterpriseIdentityClaims,
	EnterpriseProjectContext,
	EnterpriseSyncResult,
	EnterpriseSyncServiceOptions,
} from "../contracts";

function resolveEnterpriseClaims(
	bundle: EnterpriseConfigBundle,
	identity: EnterpriseSyncResult["identity"],
): EnterpriseIdentityClaims | undefined {
	return bundle.claims ?? identity?.claims;
}

function mapClaimsToRoles(
	claims: EnterpriseIdentityClaims | undefined,
	options: EnterpriseSyncServiceOptions,
): string[] {
	if (!claims) {
		return [];
	}
	if (options.claimsMapper) {
		return options.claimsMapper.mapClaimsToRoles(claims);
	}
	return claims.roles ?? [];
}

export class EnterpriseSyncService {
	private readonly authService: EnterpriseAuthService | undefined;

	constructor(private readonly options: EnterpriseSyncServiceOptions) {
		this.authService = options.identity
			? new EnterpriseAuthService({
					identity: options.identity,
					tokenStore: options.tokenStore,
				})
			: undefined;
	}

	async sync(input: {
		workspacePath: string;
		rootPath?: string;
		context?: EnterpriseProjectContext;
		paths: EnterpriseSyncResult["materialized"]["paths"];
		signal?: AbortSignal;
		now?: number;
	}): Promise<EnterpriseSyncResult> {
		const identity = this.authService
			? await this.authService.resolveIdentity({
					workspacePath: input.workspacePath,
					rootPath: input.rootPath,
					context: input.context,
					signal: input.signal,
					now: input.now,
					logger: this.options.logger,
				})
			: undefined;

		const bundle = await this.options.controlPlane.fetchBundle({
			workspacePath: input.workspacePath,
			rootPath: input.rootPath,
			context: input.context,
			identity,
			signal: input.signal,
			now: input.now,
			logger: this.options.logger,
		});

		if (!bundle) {
			throw new Error("Enterprise control plane returned no bundle");
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
		const claims = resolveEnterpriseClaims(bundle, identity);
		const roles = mapClaimsToRoles(claims, this.options);

		return {
			identity,
			bundle,
			materialized,
			telemetry,
			roles,
			claims,
		};
	}
}

export function withEnterpriseBundlePaths<T extends EnterpriseConfigBundle>(
	bundle: T,
	paths: EnterpriseSyncResult["materialized"]["paths"],
): T {
	return {
		...bundle,
		metadata: {
			...(bundle.metadata ?? {}),
			paths,
		},
	};
}
