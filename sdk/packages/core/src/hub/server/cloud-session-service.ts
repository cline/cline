import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { BasicLogger, ITelemetryService } from "@cline/shared";
import {
	createMediaBudgetState,
	FeatureFlag,
	getClineEnvironmentConfig,
	validateAndReserveImageMedia,
} from "@cline/shared";
import { z } from "zod";
import { ClineAccountService } from "../../account";
import { getProviderAuthHandler } from "../../auth/provider-auth-registry";
import { CloudSessionApi } from "../../cloud/api";
import { CLOUD_COMPUTER_USE_ENV } from "../../cloud/computer-use-prompt";
import { CloudSessionController } from "../../cloud/controller";
import type {
	CloudHubOperation,
	CloudHubScope,
} from "../../cloud/hub-protocol";
import type {
	CloudSessionEvent,
	CloudSessionSnapshot,
} from "../../cloud/types";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "../../runtime/orchestration/runtime-oauth-token-manager";
import { normalizeGitHubRemoteUrl } from "../../services/cloud-handoff/git-preflight";
import {
	applyHandoffGit,
	verifyPublishedHandoffGit,
} from "../../services/cloud-handoff/git-preparation";
import { isClineAccountFeatureEnabled } from "../../services/feature-flags/cline-account-feature-flags";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import { captureAuthRefreshSoftFailure } from "../../services/telemetry/core-events";

const id = z.string().trim().min(1);
const optionalString = z.string().nullish();
const gitValue = z
	.string()
	.min(1)
	.refine((value) => !value.startsWith("-") && !/\p{Cc}/u.test(value));
const gitSha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const localGitPlan = z
	.object({
		id,
		root: gitValue.refine(isAbsolute),
		workspaceRelativePath: z
			.string()
			.refine(
				(value) =>
					!value ||
					(!isAbsolute(value) &&
						!value
							.split(/[\\/]/)
							.some((part) => !part || part === "." || part === "..") &&
						!/\p{Cc}/u.test(value)),
			),
		repoUrl: gitValue,
		remote: gitValue,
		branch: z.string().regex(/^cline\/handoff-[0-9a-f-]{12}$/),
		headSha: gitSha,
		treeSha: gitSha,
	})
	.strict()
	.refine(
		(plan) => normalizeGitHubRemoteUrl(plan.repoUrl) === plan.repoUrl,
		"Git publication must target the selected GitHub repository",
	);
const creationOptions = z.object({
	mode: z.enum(["act", "plan", "yolo", "zen"]).optional(),
	workspaceRelativePath: z.string().optional(),
	autoApproveTools: z.boolean().optional(),
	thinking: z.boolean().optional(),
	reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
});
const createInput = creationOptions
	.extend({
		sandboxType: z.enum(["standard", "resumable"]).optional(),
		requestId: id.optional(),
		modelId: id,
		repoUrl: id,
		initialPrompt: z.string().optional(),
		initialMessage: z
			.object({
				text: z.string().refine((text) => text.trim().length > 0),
				images: z.array(z.string()).optional(),
			})
			.strict()
			.optional(),
		branch: id.optional(),
		organizationId: id.nullable().optional(),
		localGit: localGitPlan.optional(),
	})
	.strict()
	.superRefine((input, ctx) => {
		if (!input.localGit) return;
		if (input.organizationId === undefined)
			ctx.addIssue({
				code: "custom",
				path: ["organizationId"],
				message:
					"Local Git publication requires organizationId from preparation, or null for Personal",
			});
		if (!input.requestId || !input.initialMessage)
			ctx.addIssue({
				code: "custom",
				message: "Local Git publication requires requestId and initialMessage",
			});
		if (
			input.repoUrl !== input.localGit.repoUrl ||
			input.branch !== input.localGit.branch ||
			(input.workspaceRelativePath ?? "") !==
				input.localGit.workspaceRelativePath
		)
			ctx.addIssue({
				code: "custom",
				message: "Cloud workspace must match the approved Git preparation",
			});
	});
const schemas = {
	create: z.tuple([createInput]),
	attach: z.tuple([id, creationOptions.nullish()]),
	send: z.tuple([
		id,
		z.string(),
		z.enum(["queue", "steer"]).nullish(),
		optionalString,
		z.array(z.string()).nullish(),
	]),
	abort: z.tuple([id]),
	pendingPrompts: z.tuple([id]),
	updatePendingPrompt: z.tuple([
		id,
		id,
		z
			.object({
				prompt: z.string().optional(),
				delivery: z.enum(["queue", "steer"]).optional(),
			})
			.strict(),
	]),
	removePendingPrompt: z.tuple([id, id]),
	readMessages: z.tuple([id]),
	getArtifactDownloadUrl: z.tuple([id, z.string().min(1)]),
	updateTitle: z.tuple([id, z.string()]),
	delete: z.tuple([id]),
	list: z.tuple([]),
	listForDiscovery: z.tuple([
		z
			.object({ timeoutMs: z.number().positive().max(30000).optional() })
			.nullish(),
	]),
	getCrossScopeDiscoveryRecord: z.tuple([id]),
	listModels: z.tuple([]),
	listRepositories: z.tuple([]),
	listBranches: z.tuple([
		z.number().int().positive(),
		z
			.object({ cursor: z.string().optional(), query: z.string().optional() })
			.nullish(),
	]),
	respondApproval: z.tuple([
		id,
		id,
		z.object({ approved: z.boolean(), reason: z.string().optional() }).strict(),
	]),
	refreshOrganization: z.tuple([]),
	prepareHandoffRepository: z.tuple([id]),
	restoreCreationOptions: z.tuple([id, creationOptions.strict()]),
} satisfies Record<CloudHubOperation, z.ZodType>;

export interface HubCloudSessionServiceOptions {
	publish: (
		event: CloudSessionEvent | undefined,
		version: { serviceId: string; revision: number; scopeGeneration: number },
	) => void;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	/** Test/embedding seams; the daemon uses persisted account credentials. */
	getScope?: () => string | undefined;
	createController?: () => CloudSessionController;
}

/**
 * Identifies the stored Cline credentials for in-memory comparison only;
 * never serialized or logged.
 */
function credentialFingerprint(
	settings: ReturnType<ProviderSettingsManager["getProviderSettings"]>,
): string {
	const auth = settings?.auth as
		| { accessToken?: string; refreshToken?: string; expiresAt?: number }
		| undefined;
	return JSON.stringify([
		auth?.accessToken,
		auth?.refreshToken,
		auth?.expiresAt,
		settings?.apiKey,
		settings?.baseUrl,
	]);
}

/** Private change-detection state; never serialized or logged. */
type CloudAccountScope = {
	kind: "account" | "credential" | "custom";
	identity: string;
	apiBaseUrl?: string;
};

/** One account-scoped controller per hub, independent of connected viewers. */
export class HubCloudSessionService {
	private readonly serviceId = randomUUID();
	private scopeGeneration = 0;
	private revision = 0;
	private organization?: { id: string | undefined; at: number };
	private organizationGeneration = 0;
	private controller?: CloudSessionController;
	private scope?: CloudAccountScope;
	private closed = false;
	private readonly snapshots = new Map<string, CloudSessionSnapshot>();
	private readonly tokenManager: RuntimeOAuthTokenManager;
	private readonly settings = new ProviderSettingsManager();
	private readonly scopeTimer: ReturnType<typeof setInterval>;
	private readonly retiring = new Set<Promise<void>>();
	private readonly publications = new Map<
		string,
		{ planId: string; result: ReturnType<CloudSessionController["create"]> }
	>();
	activeCommands = 0;
	constructor(private readonly options: HubCloudSessionServiceOptions) {
		this.tokenManager = new RuntimeOAuthTokenManager({
			providerSettingsManager: this.settings,
			telemetry: options.telemetry,
			onCredentialsRefreshed: (previous, next) => {
				const scope = this.scope;
				// A refresh rotates credentials without changing this controller's account.
				if (
					previous.provider !== "cline" ||
					!scope ||
					scope.kind !== "credential" ||
					scope.identity !== (previous.auth?.accessToken || previous.apiKey) ||
					scope.apiBaseUrl !== previous.baseUrl
				)
					return;
				const identity =
					next.auth?.accountId || next.auth?.accessToken || next.apiKey;
				if (identity)
					Object.assign(scope, {
						kind: next.auth?.accountId ? "account" : "credential",
						identity,
						apiBaseUrl: next.baseUrl,
					});
			},
		});
		this.scopeTimer = setInterval(() => this.checkScope(), 1000);
		this.scopeTimer.unref?.();
	}
	private currentScope(): CloudAccountScope | undefined {
		if (this.options.getScope) {
			const identity = this.options.getScope();
			return identity ? { kind: "custom", identity } : undefined;
		}
		const settings = this.settings.getProviderSettings("cline");
		const accountId = settings?.auth?.accountId;
		const identity =
			accountId || settings?.auth?.accessToken || settings?.apiKey;
		return identity
			? {
					kind: accountId ? "account" : "credential",
					identity,
					apiBaseUrl: settings?.baseUrl,
				}
			: undefined;
	}
	private isCurrentScope(scope: CloudAccountScope | undefined): boolean {
		const current = this.currentScope();
		return (
			scope?.kind === current?.kind &&
			scope?.identity === current?.identity &&
			scope?.apiBaseUrl === current?.apiBaseUrl
		);
	}
	private checkScope(): void {
		if (!this.controller || this.isCurrentScope(this.scope)) return;
		const old = this.controller;
		this.controller = undefined;
		this.scope = undefined;
		for (const sessionId of this.snapshots.keys())
			this.publish({ type: "removed", sessionId });
		this.snapshots.clear();
		this.scopeGeneration++;
		this.options.publish(undefined, {
			serviceId: this.serviceId,
			revision: ++this.revision,
			scopeGeneration: this.scopeGeneration,
		});
		const disposing = old
			.dispose()
			.catch((error) =>
				this.options.logger?.error?.("Cloud controller teardown failed", {
					error,
				}),
			)
			.finally(() => this.retiring.delete(disposing));
		this.retiring.add(disposing);
	}
	private getController(): CloudSessionController {
		if (this.closed) throw new Error("Hub cloud service is closed");
		this.checkScope();
		if (this.controller) return this.controller;
		this.invalidateOrganization();
		this.scope = this.currentScope();
		const controller =
			this.options.createController?.() ?? this.createController();
		this.controller = controller;
		controller.subscribe((event) => {
			// Scope changes are checked periodically and at command/auth boundaries.
			if (this.controller !== controller || this.closed) return;
			if (event.type === "snapshot")
				this.snapshots.set(event.sessionId, event.snapshot);
			if (event.type === "removed") this.snapshots.delete(event.sessionId);
			this.publish(event);
		});
		return controller;
	}
	private createController(): CloudSessionController {
		const environment = getClineEnvironmentConfig();
		const scope = this.scope;
		const apiBaseUrl =
			this.settings
				.getProviderSettings("cline")
				?.baseUrl?.trim()
				.replace(/\/api\/v1\/*$/, "") || environment.apiBaseUrl;
		// The stored credentials the auth server last rejected outright. The
		// controller polls through getAuthToken every few seconds; without this,
		// a signed-out user's dead refresh token was re-sent on every poll, and
		// each rejection re-emitted user.auth_logged_out plus a soft-failure
		// event (~670 of each per machine per 3h on core 0.2.0). Any write to
		// the stored credentials (sign-in, sign-out, rotation) clears it.
		let rejectedCredentials: string | undefined;
		const getAuthToken = async () => {
			if (!this.isCurrentScope(scope)) throw new Error("Cline account changed");
			const credentials = credentialFingerprint(
				this.settings.getProviderSettings("cline"),
			);
			if (credentials === rejectedCredentials) return undefined;
			rejectedCredentials = undefined;
			let token: string | undefined;
			let refreshError: unknown;
			try {
				token = (
					await this.tokenManager.resolveProviderApiKey({ providerId: "cline" })
				)?.apiKey;
			} catch (error) {
				refreshError = error;
			}
			if (refreshError instanceof OAuthReauthRequiredError) {
				// A definitive rejection, already reported once as
				// user.auth_logged_out by the refresh path. Not a soft failure.
				rejectedCredentials = credentials;
				if (!this.isCurrentScope(scope))
					throw new Error("Cline account changed");
				return undefined;
			}
			if (!token) {
				token = getProviderAuthHandler("cline")?.getApiKey(
					this.settings.getProviderSettings("cline"),
				);
			}
			if (!token && refreshError) {
				this.options.logger?.error?.("Cloud account token refresh failed", {
					error: refreshError,
				});
				captureAuthRefreshSoftFailure(this.options.telemetry, "cline", {
					errorName:
						refreshError instanceof Error ? refreshError.name : "Error",
					errorCode: "hub_cloud_refresh_failed_no_fallback_token",
				});
			}
			if (!this.isCurrentScope(scope)) throw new Error("Cline account changed");
			return token;
		};
		const account = new ClineAccountService({ apiBaseUrl, getAuthToken });
		return new CloudSessionController({
			api: new CloudSessionApi({
				apiBaseUrl,
				appBaseUrl: environment.appBaseUrl,
				getAuthToken,
			}),
			apiBaseUrl,
			getAuthToken,
			logger: this.options.logger,
			clientIdentity: {
				prefix: "hub-cloud",
				type: "hub-cloud",
				displayName: "Cline Hub cloud session",
				source: "desktop",
			},
			lateCreateDisposition: "preserve",
			isComputerUseEnabled: async () =>
				process.env[CLOUD_COMPUTER_USE_ENV] === "1" ||
				(await isClineAccountFeatureEnabled(FeatureFlag.CLOUD_COMPUTER_USE)),
			getActiveOrganizationId: async (options) => {
				if (options?.fresh) this.invalidateOrganization();
				const organization = this.organization;
				if (
					!options?.fresh &&
					organization &&
					Date.now() - organization.at < 60000
				)
					return organization.id;
				const generation = this.organizationGeneration;
				if (!(await getAuthToken())) return undefined;
				const organizations = await account.fetchUserOrganizations();
				const id = organizations?.find((org) => org.active)?.organizationId;
				if (generation === this.organizationGeneration)
					this.organization = { id, at: Date.now() };
				return id;
			},
		});
	}
	private publish(event: CloudSessionEvent): void {
		this.options.publish(event, {
			serviceId: this.serviceId,
			revision: ++this.revision,
			scopeGeneration: this.scopeGeneration,
		});
	}
	snapshot(): {
		serviceId: string;
		revision: number;
		scopeGeneration: number;
		snapshots: CloudSessionSnapshot[];
	} {
		this.checkScope();
		return {
			serviceId: this.serviceId,
			revision: this.revision,
			scopeGeneration: this.scopeGeneration,
			snapshots: [...this.snapshots.values()],
		};
	}
	private invalidateOrganization(): void {
		this.organization = undefined;
		this.organizationGeneration++;
	}
	watch(): ReturnType<HubCloudSessionService["snapshot"]> {
		// A returning viewer may have switched organization while the Hub was unreachable.
		this.invalidateOrganization();
		this.getController();
		return this.snapshot();
	}
	async command(
		operation: string,
		rawArgs: unknown,
		expectedScope: unknown,
	): Promise<Record<string, unknown>> {
		if (!Object.hasOwn(schemas, operation))
			throw new Error(`Unknown cloud operation: ${operation}`);
		const name = operation as CloudHubOperation;
		const args = schemas[name].parse(rawArgs) as unknown[];
		// JSON arrays encode omitted optional arguments as null.
		const normalized = args.map((value) =>
			value === null ? undefined : value,
		);
		if (name === "create") {
			const input = normalized[0] as { sandboxType?: string };
			input.sandboxType ??= "resumable";
		}
		const expected = z
			.object({
				serviceId: z.string(),
				scopeGeneration: z.number().int(),
				expectedAccountId: id.optional(),
			})
			.parse(expectedScope) satisfies CloudHubScope;
		const controller = this.getController();
		if (
			expected.serviceId !== this.serviceId ||
			expected.scopeGeneration !== this.scopeGeneration
		)
			throw new Error("Cloud account changed before request");
		if (expected.expectedAccountId !== undefined) {
			const account = this.scope;
			if (
				account?.kind !== "account" ||
				account.identity !== expected.expectedAccountId
			)
				throw new Error(
					"The cloud account does not match the signed-in account. Sign in again before continuing.",
				);
		}
		this.activeCommands++;
		try {
			const result =
				name === "create"
					? await this.create(controller, createInput.parse(normalized[0]))
					: await (controller[name] as (...args: unknown[]) => unknown).apply(
							controller,
							normalized,
						);
			this.checkScope();
			if (this.controller !== controller)
				throw new Error("Cline account changed during cloud operation");
			return {
				serviceId: this.serviceId,
				revision: this.revision,
				scopeGeneration: this.scopeGeneration,
				result,
			};
		} finally {
			this.activeCommands--;
		}
	}
	private create(
		controller: CloudSessionController,
		input: z.infer<typeof createInput>,
	): ReturnType<CloudSessionController["create"]> {
		const { localGit, ...creation } = input;
		if (!localGit) return controller.create(creation);
		const key = `${this.scopeGeneration}:${input.requestId}`;
		const existing = this.publications.get(key);
		if (existing) {
			if (existing.planId !== localGit.id)
				throw new Error("The request already has a different Git preparation");
			return existing.result;
		}
		const assertCurrent = () => {
			this.checkScope();
			if (this.closed || this.controller !== controller)
				throw new Error("Cline account changed during cloud publication");
		};
		const result = Promise.resolve()
			.then(async () => {
				assertCurrent();
				const images = input.initialMessage?.images ?? [];
				const budget = createMediaBudgetState();
				for (const image of images) {
					const validation = validateAndReserveImageMedia(
						undefined,
						image,
						{},
						budget,
					);
					if (!validation.ok) throw new Error(validation.message);
				}
				const { organizationId } = await controller.prepareHandoffRepository(
					localGit.repoUrl,
				);
				assertCurrent();
				if ((organizationId ?? null) !== (creation.organizationId ?? null))
					throw new Error("The cloud organization changed before publication");
				const models = await controller.listModels();
				assertCurrent();
				if (!models.some((model) => model.id === input.modelId))
					throw new Error(
						"The selected model is not available in Cline Cloud for this account",
					);
				const headSha = await applyHandoffGit(localGit);
				assertCurrent();
				await verifyPublishedHandoffGit(localGit, headSha);
				assertCurrent();
				return controller.create(creation);
			})
			.finally(() => this.publications.delete(key));
		this.publications.set(key, { planId: localGit.id, result });
		return result;
	}
	async dispose(): Promise<void> {
		this.closed = true;
		clearInterval(this.scopeTimer);
		const controller = this.controller;
		this.controller = undefined;
		this.snapshots.clear();
		await Promise.all([controller?.dispose(), ...this.retiring]);
	}
}
