import { randomUUID } from "node:crypto";
import {
	ClineAccountService,
	completeClineDeviceAuth,
	NodeHubClient,
	type OAuthCredentials,
	ProviderSettingsManager,
	RuntimeOAuthTokenManager,
	saveLocalProviderOAuthCredentials,
	startClineDeviceAuth,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";

const CLOUD_WORKSPACE_ROOT = "/workspace";
const REQUEST_TIMEOUT_MS = 15_000;
const PROVISION_TIMEOUT_MS = 610_000;
const PROVISION_POLL_MS = 3_000;

type FetchLike = typeof fetch;
type HubClient = Pick<NodeHubClient, "connect" | "command" | "dispose">;

export type SpawnCloudAgentInput = {
	prompt: string;
	repoUrl: string;
	modelId: string;
	branch?: string;
	organizationId?: string | null;
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	thinking?: boolean;
	autoApproveTools?: boolean;
};

export type SpawnCloudAgentResult = {
	operationId: string;
	cloudSessionId: string;
	agentSessionId: string;
	dashboardUrl: string;
	status: "running";
};

export type CloudAgentSpawnStage =
	| "authenticating"
	| "resolving_organization"
	| "creating_workspace"
	| "provisioning_workspace"
	| "connecting_agent"
	| "starting_agent"
	| "submitting_prompt";

export type SpawnCloudAgentStartResult = {
	operationId: string;
	status: "pending";
	stage: CloudAgentSpawnStage;
	message: string;
	pollAfterMs: number;
	cloudSessionId?: string;
};

export type CloudAgentSpawnStatus =
	| SpawnCloudAgentStartResult
	| SpawnCloudAgentResult
	| {
			operationId: string;
			status: "failed";
			error: string;
			cloudSessionId?: string;
			dashboardUrl?: string;
	  };

export type ClineOAuthStartResult = {
	flowId: string;
	status: "pending";
	userCode: string;
	verificationUrl: string;
	expiresAt: string;
};

export type ClineOAuthStatus =
	| { flowId: string; status: "pending"; expiresAt: string }
	| { flowId: string; status: "authenticated" }
	| { flowId: string; status: "failed"; error: string };

type CloudEnvironment = { apiBaseUrl: string; appBaseUrl: string };

type CloudAgentSpawnerOptions = {
	fetch?: FetchLike;
	resolveAuthToken?: () => Promise<string | undefined>;
	resolveEnvironment?: () => CloudEnvironment;
	createHubClient?: (
		options: ConstructorParameters<typeof NodeHubClient>[0],
	) => HubClient;
	sleep?: (milliseconds: number) => Promise<void>;
	providerSettingsManager?: ProviderSettingsManager;
	startDeviceAuth?: typeof startClineDeviceAuth;
	completeDeviceAuth?: typeof completeClineDeviceAuth;
};

type OAuthFlowState =
	| { status: "pending"; expiresAt: string }
	| { status: "authenticated" }
	| { status: "failed"; error: string };

class CloudAgentError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "CloudAgentError";
	}
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function websocketUrl(apiBaseUrl: string, cloudSessionId: string): string {
	const url = new URL(
		`/api/v1/session/${encodeURIComponent(cloudSessionId)}`,
		apiBaseUrl,
	);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

function dashboardUrl(appBaseUrl: string, cloudSessionId: string): string {
	const url = new URL("/agents", appBaseUrl);
	url.searchParams.set("sessionId", cloudSessionId);
	return url.toString();
}

async function defaultAuthToken(): Promise<string | undefined> {
	const explicit = process.env.CLINE_API_KEY?.trim();
	if (explicit) return explicit;
	return (
		await new RuntimeOAuthTokenManager().resolveProviderApiKey({
			providerId: "cline",
		})
	)?.apiKey;
}

export class CloudAgentSpawner {
	private readonly fetchImpl: FetchLike;
	private readonly resolveAuthToken: () => Promise<string | undefined>;
	private readonly resolveEnvironment: () => CloudEnvironment;
	private readonly createHubClient: NonNullable<
		CloudAgentSpawnerOptions["createHubClient"]
	>;
	private readonly sleep: (milliseconds: number) => Promise<void>;
	private readonly providerSettingsManager: ProviderSettingsManager;
	private readonly startDeviceAuth: typeof startClineDeviceAuth;
	private readonly completeDeviceAuth: typeof completeClineDeviceAuth;
	private readonly oauthFlows = new Map<string, OAuthFlowState>();
	private readonly spawnOperations = new Map<string, CloudAgentSpawnStatus>();

	constructor(options: CloudAgentSpawnerOptions = {}) {
		this.fetchImpl = options.fetch ?? fetch;
		this.resolveAuthToken = options.resolveAuthToken ?? defaultAuthToken;
		this.resolveEnvironment =
			options.resolveEnvironment ?? getClineEnvironmentConfig;
		this.createHubClient =
			options.createHubClient ?? ((value) => new NodeHubClient(value));
		this.sleep =
			options.sleep ??
			((milliseconds) =>
				new Promise((resolve) => setTimeout(resolve, milliseconds)));
		this.providerSettingsManager =
			options.providerSettingsManager ?? new ProviderSettingsManager();
		this.startDeviceAuth = options.startDeviceAuth ?? startClineDeviceAuth;
		this.completeDeviceAuth =
			options.completeDeviceAuth ?? completeClineDeviceAuth;
	}

	async startOAuth(): Promise<ClineOAuthStartResult> {
		const authorization = await this.startDeviceAuth();
		const flowId = randomUUID();
		const expiresAt = new Date(
			Date.now() + authorization.expiresInSeconds * 1_000,
		).toISOString();
		this.oauthFlows.set(flowId, { status: "pending", expiresAt });
		const existing = this.providerSettingsManager.getProviderSettings("cline");
		void this.completeDeviceAuth({
			deviceCode: authorization.deviceCode,
			expiresInSeconds: authorization.expiresInSeconds,
			pollIntervalSeconds: authorization.pollIntervalSeconds,
			apiBaseUrl: this.resolveEnvironment().apiBaseUrl,
			provider: "cline",
		})
			.then((credentials: OAuthCredentials) => {
				saveLocalProviderOAuthCredentials(
					this.providerSettingsManager,
					"cline",
					existing,
					credentials,
				);
				this.oauthFlows.set(flowId, { status: "authenticated" });
			})
			.catch((error: unknown) => {
				this.oauthFlows.set(flowId, {
					status: "failed",
					error: error instanceof Error ? error.message : String(error),
				});
			});
		return {
			flowId,
			status: "pending",
			userCode: authorization.userCode,
			verificationUrl:
				authorization.verificationUriComplete ?? authorization.verificationUri,
			expiresAt,
		};
	}

	getOAuthStatus(flowId: string): ClineOAuthStatus {
		const state = this.oauthFlows.get(flowId);
		if (!state) {
			return {
				flowId,
				status: "failed",
				error: "OAuth flow was not found. Start a new Cline OAuth flow.",
			};
		}
		return { flowId, ...state };
	}

	startSpawn(input: SpawnCloudAgentInput): SpawnCloudAgentStartResult {
		const operationId = randomUUID();
		const started: SpawnCloudAgentStartResult = {
			operationId,
			status: "pending",
			stage: "authenticating",
			message: "Checking Cline credentials.",
			pollAfterMs: PROVISION_POLL_MS,
		};
		this.spawnOperations.set(operationId, started);
		void this.runSpawn(operationId, input).catch((error: unknown) => {
			const current = this.spawnOperations.get(operationId);
			const cloudSessionId =
				current && "cloudSessionId" in current
					? current.cloudSessionId
					: undefined;
			this.spawnOperations.set(operationId, {
				operationId,
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
				...(cloudSessionId
					? {
							cloudSessionId,
							dashboardUrl: dashboardUrl(
								this.resolveEnvironment().appBaseUrl,
								cloudSessionId,
							),
						}
					: {}),
			});
		});
		return started;
	}

	getSpawnStatus(operationId: string): CloudAgentSpawnStatus {
		return (
			this.spawnOperations.get(operationId) ?? {
				operationId,
				status: "failed",
				error:
					"Cloud-agent operation was not found. Start a new spawn operation.",
			}
		);
	}

	private updateSpawnProgress(
		operationId: string,
		stage: CloudAgentSpawnStage,
		message: string,
		cloudSessionId?: string,
	): void {
		this.spawnOperations.set(operationId, {
			operationId,
			status: "pending",
			stage,
			message,
			pollAfterMs: PROVISION_POLL_MS,
			...(cloudSessionId ? { cloudSessionId } : {}),
		});
	}

	private async runSpawn(
		operationId: string,
		input: SpawnCloudAgentInput,
	): Promise<void> {
		const token = (await this.resolveAuthToken())?.trim();
		if (!token) {
			throw new CloudAgentError(
				"Cline authentication is required. Sign in with Cline or set CLINE_API_KEY for the MCP server.",
				401,
			);
		}
		const environment = this.resolveEnvironment();
		this.updateSpawnProgress(
			operationId,
			"resolving_organization",
			"Resolving the Cline organization for this workspace.",
		);
		const organizationId = await this.resolveOrganizationId(
			input.organizationId,
			token,
			environment.apiBaseUrl,
		);
		this.updateSpawnProgress(
			operationId,
			"creating_workspace",
			"Requesting a new Cline Cloud workspace.",
		);
		const created = await this.request<{ sessionId?: string; status?: string }>(
			environment.apiBaseUrl,
			token,
			"/api/v1/session",
			{
				method: "POST",
				body: JSON.stringify({
					modelId: input.modelId,
					repoUrl: input.repoUrl,
					...(input.branch?.trim() ? { branch: input.branch.trim() } : {}),
					...(organizationId ? { organizationId } : {}),
				}),
				signal: AbortSignal.timeout(PROVISION_TIMEOUT_MS),
			},
		);
		const cloudSessionId = created?.sessionId?.trim();
		if (!cloudSessionId) {
			throw new CloudAgentError(
				"The cloud session service returned no session id.",
			);
		}
		if (created.status?.toLowerCase() !== "ready") {
			this.updateSpawnProgress(
				operationId,
				"provisioning_workspace",
				"The cloud workspace is provisioning. This commonly takes several minutes.",
				cloudSessionId,
			);
			await this.waitUntilReady(environment.apiBaseUrl, token, cloudSessionId);
		}
		this.updateSpawnProgress(
			operationId,
			"connecting_agent",
			"The workspace is ready; connecting to its agent runtime.",
			cloudSessionId,
		);

		const client = this.createHubClient({
			url: websocketUrl(environment.apiBaseUrl, cloudSessionId),
			clientId: `agent-plugin-cloud-${randomUUID()}`,
			clientType: "agent-plugin-cloud-spawner",
			displayName: "Cloud agent spawner",
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			cwd: CLOUD_WORKSPACE_ROOT,
			resolveConnectionHeaders: async () => ({
				Authorization: `Bearer ${(await this.resolveAuthToken())?.trim() || token}`,
			}),
		});

		try {
			await client.connect();
			this.updateSpawnProgress(
				operationId,
				"starting_agent",
				"Creating the Cline agent session inside the cloud workspace.",
				cloudSessionId,
			);
			const creation = await client.command("session.create", {
				workspaceRoot: CLOUD_WORKSPACE_ROOT,
				cwd: CLOUD_WORKSPACE_ROOT,
				sessionConfig: {
					providerId: "cline",
					modelId: input.modelId,
					workspaceRoot: CLOUD_WORKSPACE_ROOT,
					cwd: CLOUD_WORKSPACE_ROOT,
					systemPrompt:
						"You are running in a Cline Cloud workspace cloned from GitHub. Work autonomously on the user's task and leave the repository in a useful state.",
					mode: "act",
					enableTools: true,
					...(typeof input.thinking === "boolean"
						? { thinking: input.thinking }
						: {}),
					...(input.reasoningEffort
						? { reasoningEffort: input.reasoningEffort }
						: {}),
				},
				metadata: {
					source: "agent-plugin",
					provider: "cline",
					model: input.modelId,
					interactive: true,
					cloudSessionId,
				},
				runtimeOptions: { mode: "act" },
				modelSelection: { provider: "cline", model: input.modelId },
				toolPolicies: {
					"*": { autoApprove: input.autoApproveTools !== false },
				},
			});
			const session = creation.payload?.session;
			const agentSessionId = String(
				(session && typeof session === "object" && "sessionId" in session
					? session.sessionId
					: creation.payload?.sessionId) ?? "",
			).trim();
			if (!agentSessionId) {
				throw new CloudAgentError(
					"Cloud Hub did not return an agent session id.",
				);
			}
			await client.command(
				"session.attach",
				{ sessionId: agentSessionId },
				agentSessionId,
			);
			this.updateSpawnProgress(
				operationId,
				"submitting_prompt",
				"Submitting the task to the cloud agent.",
				cloudSessionId,
			);
			await client.command(
				"session.send_input",
				{ prompt: input.prompt },
				agentSessionId,
				{ timeoutMs: null },
			);
			this.spawnOperations.set(operationId, {
				operationId,
				cloudSessionId,
				agentSessionId,
				dashboardUrl: dashboardUrl(environment.appBaseUrl, cloudSessionId),
				status: "running",
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CloudAgentError(
				`Cloud workspace ${cloudSessionId} was created, but its agent could not be started: ${message}`,
			);
		} finally {
			await client.dispose().catch(() => undefined);
		}
	}

	private async resolveOrganizationId(
		requested: string | null | undefined,
		token: string,
		apiBaseUrl: string,
	): Promise<string | undefined> {
		if (requested === null) return undefined;
		if (requested?.trim()) return requested.trim();
		const service = new ClineAccountService({
			apiBaseUrl,
			getAuthToken: async () => token,
		});
		const organizations = await service.fetchUserOrganizations();
		return organizations?.find(
			(organization: { active?: boolean }) => organization.active,
		)?.organizationId;
	}

	private async waitUntilReady(
		apiBaseUrl: string,
		token: string,
		cloudSessionId: string,
	): Promise<void> {
		const deadline = Date.now() + PROVISION_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const result = await this.request<{
				status?: string;
				statusReason?: string;
			}>(
				apiBaseUrl,
				token,
				`/api/v1/session/${encodeURIComponent(cloudSessionId)}/status`,
			);
			const status = result?.status?.trim().toLowerCase();
			if (status === "ready" || status === "active") return;
			if (status === "failed") {
				throw new CloudAgentError(
					result.statusReason?.trim() ||
						"The cloud workspace could not be prepared.",
				);
			}
			if (status !== "provisioning") {
				throw new CloudAgentError(
					`Unexpected cloud provisioning status: ${status || "missing"}.`,
				);
			}
			await this.sleep(PROVISION_POLL_MS);
		}
		throw new CloudAgentError(
			"Timed out waiting for the cloud workspace to be ready.",
		);
	}

	private async request<T>(
		apiBaseUrl: string,
		token: string,
		path: string,
		init: RequestInit = {},
	): Promise<T> {
		const response = await this.fetchImpl(
			`${trimTrailingSlash(apiBaseUrl)}${path}`,
			{
				...init,
				signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${token}`,
					...(init.body ? { "Content-Type": "application/json" } : {}),
					...init.headers,
				},
			},
		);
		const payload = (await response.json().catch(() => undefined)) as
			| { data?: T; error?: string }
			| undefined;
		if (!response.ok) {
			throw new CloudAgentError(
				payload?.error?.trim() || `Cloud request failed (${response.status}).`,
				response.status,
			);
		}
		return payload?.data as T;
	}
}
