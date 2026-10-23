/**
 * The CLOUD connection path: a REST-managed sandbox reached through the WS proxy.
 *
 * This mirrors {@link createLocalSessionHandle} but with the real
 * {@link CloudSessionGateway} instead of a fake, and a `bearer-header` hub client
 * whose credential is the Cline JWT with the `workos:` prefix. The gateway maps
 * each session's `sandboxUrl` to the proxy URL, so {@link resolveCloudSession}
 * connects through core-api exactly as it would to any sandbox — the only
 * difference from local is the auth mode and the URL, not the protocol.
 *
 * As with local, auth lives entirely in the client factory; the resolver and
 * `SessionConnection` cannot tell a cloud handle from a local one.
 */

import {
	HubClient,
	type HubClientOptions,
	type WebSocketCtor,
} from "@cline/hub-client";
import { buildClineSystemPrompt } from "@cline/shared";
import { formatCloudCredential } from "../cloud/auth/credential";
import {
	CloudSessionApiError,
	CloudSessionGateway,
	type CloudSessionGatewayOptions,
} from "../cloud/rest/CloudSessionGateway";
import {
	ASK_QUESTION_CAPABILITY,
	type HubClientFactory,
	type RemoteSession,
	type RemoteSessionGateway,
	type RemoteSessionId,
	resolveCloudSession,
	type SessionDiagnostic,
	type SessionHandle,
} from "../session";
import {
	type CloudSessionProgress,
	isRemoteSessionUnavailable,
} from "../session/cloud-resolver";
import { cloudClientId } from "./cloud-client-identity";

const CLOUD_WORKSPACE_ROOT = "/workspace";
const GITHUB_AUTH_SYSTEM_PROMPT =
	"IMPORTANT: GitHub API authentication is handled automatically by the infrastructure. " +
	"A secrets-proxy sidecar injects the necessary authentication credentials into all GitHub API requests. " +
	"You do NOT need to set up, configure, or manage any authentication tokens, API keys, or credentials for GitHub API calls. " +
	"Simply make your GitHub API calls normally — authentication will be injected transparently.";

/** Thrown when no remote session id was given and the account has none. */
export class NoCloudSessionsError extends Error {
	constructor() {
		super(
			"No Cline Cloud sessions are available. Create one before connecting.",
		);
		this.name = "NoCloudSessionsError";
	}
}

export interface CreateCloudSessionHandleOptions {
	/** core-api base (no trailing slash) for REST + the WS proxy. */
	apiBaseUrl: string;
	/** Resolves the raw Cline JWT (WITHOUT the `workos:` prefix). */
	getAccessToken: () => Promise<string | null>;
	/**
	 * The specific remote session to connect. When omitted, the newest session
	 * from the gateway is used (throws {@link NoCloudSessionsError} if none).
	 */
	remoteSessionId?: RemoteSessionId;
	/** Org scope for listing/creating sessions. */
	organizationId?: string;
	/** Legacy caller compatibility; Cloud always reuses its assigned/root conversation. */
	createNewSession?: boolean;
	allowInitialCreate?: boolean;
	signal?: AbortSignal;
	onProgress?: (progress: CloudSessionProgress) => void;
	/** Cline model recorded on the outer Cloud session. */
	modelId?: string;
	/** Exact inner session, when a caller has already resolved one. */
	hubSessionId?: string;
	/** Override the `session.create` payload (advanced/tests). */
	createSessionInput?: Record<string, unknown>;
	clientType?: string;
	displayName?: string;
	/** Test seam: swap the REST gateway for a fake. */
	gateway?: RemoteSessionGateway;
	/** Test seam: swap the hub client factory. */
	clientFactory?: HubClientFactory;
	/** Injectable socket, so a test can drive drops/reconnects. */
	WebSocketImpl?: WebSocketCtor;
	onDiagnostic?: (diagnostic: SessionDiagnostic) => void;
}

/** The same inner ClineCore session payload used by Cline desktop. */
export function buildCloudCreateSessionInput(
	modelId: string,
	taskId?: string,
	remoteSessionId?: string,
	sandboxType?: RemoteSession["sandboxType"],
): Record<string, unknown> {
	const normalizedModelId = modelId.trim();
	if (!normalizedModelId) {
		throw new Error("Cloud session is missing its model id.");
	}
	const branch = `cline/${(taskId?.trim() || remoteSessionId || "").slice(-8).toLowerCase()}`;
	const saveWork =
		taskId?.trim() || remoteSessionId
			? `\n\nDo all work for this task on the branch \`${branch}\`: create it from the current checkout before your first change ` +
				"(or check it out if it already exists), and never commit directly to the default branch. " +
				(sandboxType === "resumable"
					? "Commit and push only when the user asks. "
					: "SAVE YOUR WORK: This sandbox is temporary. Push your progress to origin so it remains available outside the sandbox. " +
						`The branch \`${branch}\` is a backup of your work-in-progress, not a finished deliverable, so commit to it freely even when the work is incomplete. ` +
						"Commit regularly as you complete meaningful steps, using clear, descriptive messages. " +
						`The first time you commit, push the branch with \`git push -u origin ${branch}\`, and push again after each later commit. `) +
				"Do not force-push or amend commits that are already pushed unless the user explicitly asks."
			: "";
	const systemPrompt = buildClineSystemPrompt({
		ide: "Cline",
		mode: "act",
		platform: "cloud",
		providerId: "cline",
		workspaceRoot: CLOUD_WORKSPACE_ROOT,
		rules: GITHUB_AUTH_SYSTEM_PROMPT + saveWork,
	});
	return {
		workspaceRoot: CLOUD_WORKSPACE_ROOT,
		cwd: CLOUD_WORKSPACE_ROOT,
		sessionConfig: {
			...(taskId?.trim() ? { sessionId: taskId.trim() } : {}),
			providerId: "cline",
			modelId: normalizedModelId,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			cwd: CLOUD_WORKSPACE_ROOT,
			systemPrompt,
			mode: "act",
			enableTools: true,
		},
		metadata: {
			source: "mobile",
			provider: "cline",
			model: normalizedModelId,
			interactive: true,
		},
		runtimeOptions: {
			mode: "act",
			clientContributions: [
				{
					kind: "toolExecutor",
					executor: "askQuestion",
					capabilityName: ASK_QUESTION_CAPABILITY,
				},
			],
		},
		modelSelection: { provider: "cline", model: normalizedModelId },
		// Match desktop Cloud's default; phone-local tier settings do not
		// configure the sandbox's tool policy.
		toolPolicies: { "*": { autoApprove: true } },
	};
}

/**
 * Newest wins: `updatedAt`, then `createdAt`, then a stable id tie-break — the
 * same ordering the resolver uses for inner sessions.
 */
function selectNewestRemoteSession(
	sessions: RemoteSession[],
): RemoteSession | undefined {
	return [...sessions].sort((left, right) => {
		const leftAt = left.updatedAt ?? left.createdAt ?? 0;
		const rightAt = right.updatedAt ?? right.createdAt ?? 0;
		if (leftAt !== rightAt) {
			return rightAt - leftAt;
		}
		return left.id < right.id ? -1 : 1;
	})[0];
}

/**
 * The {@link HubClientOptions} for a cloud sandbox connection.
 *
 * Exported (and pure) so the bearer-header + `workos:` wiring is unit-testable
 * without standing up a socket. `jwt` is the raw Cline access token; the
 * `workos:` prefix is added here.
 */
export function buildCloudHubClientOptions(input: {
	url: string;
	jwt: string;
	clientType?: string;
	displayName?: string;
	WebSocketImpl?: WebSocketCtor;
}): ConstructorParameters<typeof HubClient>[0] {
	return {
		url: input.url,
		authMode: "bearer-header",
		credential: formatCloudCredential(input.jwt),
		clientType: input.clientType ?? "cline-mobile",
		displayName: input.displayName ?? "Cline",
		...(input.WebSocketImpl ? { WebSocketImpl: input.WebSocketImpl } : {}),
	};
}

/** Checks sandbox availability and refreshes credentials before each socket attempt. */
export class RefreshingCloudHubClient extends HubClient {
	private connectAttempt?: Promise<void>;
	private closeEpoch = 0;

	constructor(
		options: HubClientOptions,
		private readonly getAccessToken: () => Promise<string | null>,
		private readonly getRemoteSession: () => Promise<RemoteSession | undefined>,
	) {
		super(options);
	}

	override async connect(): Promise<void> {
		if (this.isConnected()) return;
		this.connectAttempt ??= this.connectToRunningWorkspace().finally(() => {
			this.connectAttempt = undefined;
		});
		await this.connectAttempt;
	}

	override close(): void {
		this.closeEpoch += 1;
		super.close();
	}

	private async connectToRunningWorkspace(): Promise<void> {
		const epoch = this.closeEpoch;
		const remote = await this.getRemoteSession().catch((error: unknown) => {
			if (
				epoch === this.closeEpoch &&
				error instanceof CloudSessionApiError &&
				[401, 403, 404, 410].includes(error.status)
			)
				this.stopReconnecting(error);
			throw error;
		});
		if (epoch !== this.closeEpoch) throw new Error("Cloud connection closed.");
		if (
			!remote ||
			remote.status === "suspended" ||
			isRemoteSessionUnavailable(remote, Date.now())
		) {
			const detail =
				remote?.status === "suspended"
					? "This workspace is paused. Reconnect to resume it."
					: "This workspace is no longer available.";
			this.stopReconnecting(new Error(detail));
		}
		if (remote.status !== "running") {
			throw new Error("Cline Cloud is still preparing this workspace.");
		}
		const jwt = await this.getAccessToken();
		if (epoch !== this.closeEpoch) throw new Error("Cloud connection closed.");
		if (!jwt?.trim()) {
			this.stopReconnecting(
				new CloudSessionApiError(
					"Cannot connect to Cline Cloud without a signed-in token.",
					401,
				),
			);
		}
		this.options.credential = formatCloudCredential(jwt);
		await super.connect();
	}

	private stopReconnecting(error: Error): never {
		this.close();
		// The dropped socket is already gone, so HubClient.close emits no state.
		this.options.onConnectionState?.({
			state: "closed",
			connectionEpoch: this.getConnectionEpoch(),
			detail: error.message,
		});
		throw error;
	}
}

/**
 * Connects to a cloud sandbox through the core-api WS proxy and resolves a
 * {@link SessionHandle} ready for `SessionConnection`. Fresh sandboxes come back
 * with `needsCreate === true`; the inner session is created on the first send.
 */
export async function createCloudSessionHandle(
	options: CreateCloudSessionHandleOptions,
): Promise<SessionHandle> {
	const gateway =
		options.gateway ??
		new CloudSessionGateway({
			apiBaseUrl: options.apiBaseUrl,
			getAccessToken: options.getAccessToken,
			...(options.organizationId
				? { organizationId: options.organizationId }
				: {}),
		} satisfies CloudSessionGatewayOptions);

	let remoteSessionId = options.remoteSessionId;
	if (!remoteSessionId) {
		const sessions = await gateway.listRemoteSessions();
		const newest = selectNewestRemoteSession(sessions);
		if (!newest) {
			throw new NoCloudSessionsError();
		}
		remoteSessionId = newest.id;
	}

	const clientId = options.clientFactory
		? undefined
		: await cloudClientId(remoteSessionId);
	return await resolveCloudSession({
		gateway,
		remoteSessionId,
		...(options.createSessionInput
			? { createSessionInput: options.createSessionInput }
			: {
					createSessionInput: (remote: RemoteSession) =>
						buildCloudCreateSessionInput(
							options.modelId?.trim() || remote.modelId || "",
							remote.taskId,
							remote.id,
							remote.sandboxType,
						),
				}),
		allowInitialCreate: options.allowInitialCreate ?? false,
		signal: options.signal,
		onProgress: options.onProgress,
		...(options.hubSessionId ? { hubSessionId: options.hubSessionId } : {}),
		...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
		clientFactory:
			options.clientFactory ??
			(({ url, remoteSession, onConnectionState }) =>
				new RefreshingCloudHubClient(
					{
						clientId,
						...buildCloudHubClientOptions({
							url,
							// Refreshed before the first socket is constructed.
							jwt: "",
							...(options.clientType ? { clientType: options.clientType } : {}),
							...(options.displayName
								? { displayName: options.displayName }
								: {}),
							...(options.WebSocketImpl
								? { WebSocketImpl: options.WebSocketImpl }
								: {}),
						}),
						onConnectionState,
					},
					options.getAccessToken,
					() => gateway.getRemoteSession(remoteSession.id),
				)),
	});
}
