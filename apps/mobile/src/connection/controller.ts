import type { ModelCatalogView } from "@/session";
import { parseSessionRecordReply } from "../session/schemas";
/**
 * The headless bridge between one {@link ConnectionDescriptor} and the tested
 * session core. Pure TypeScript — no React — so it can be unit-tested directly
 * and the hook on top of it stays trivial.
 *
 * It owns the whole lifecycle: build a {@link SessionHandle} for the descriptor,
 * wrap it in a {@link SessionConnection}, run the connect/hydrate handshake, and
 * expose a single immutable snapshot (`{ view, status }`) plus the write
 * operations a chat screen needs. `view` is the session view model (messages,
 * approvals, run/connection status); `status` is the *bootstrap* lifecycle
 * (connecting the socket and hydrating), which is distinct from the in-session
 * `view.connectionStatus` that tracks live/reconnecting once we are up.
 *
 * Reconnection after a transport drop is already handled inside
 * `SessionConnection` (it resyncs on every new connection epoch); this only adds
 * a manual {@link SessionConnectionController.reconnect} for a user-driven retry,
 * and surfaces a failed initial connect as `status.phase === "error"`.
 */

import type { WebSocketCtor } from "@cline/hub-client";
import { cloudStartStatus } from "../cloud/progress";
import { cloudTaskBranch } from "../cloud/task-branch";
import { cloudEnv } from "../config/env";
import { userErrorMessage } from "../error-message";
import {
	type ApprovalPolicy,
	asHubSessionId,
	asRemoteSessionId,
	createSessionState,
	parseSessionCreateReply,
	SessionConnection,
	type SessionDiagnostic,
	type SessionHandle,
	type SessionInputAttachments,
	type SessionViewModel,
	selectViewModel,
} from "../session";
import { createCloudSessionHandle } from "./cloud-handle";
import type { ConnectionDescriptor } from "./endpoints";
import { createLocalSessionHandle } from "./local-handle";
import { resolveLocalTransport } from "./local-transport";

export type ConnectionPhase = "connecting" | "ready" | "error" | "closed";

export interface ConnectionStatus {
	phase: ConnectionPhase;
	progress?: string;
	/** Present only when `phase === "error"`. */
	error?: Error;
}

export interface ConnectionSnapshot {
	/** Explicit choice awaiting acknowledgement; otherwise the server owns reasoning. */
	pendingReasoning?: ReasoningChoice;
	view: SessionViewModel;
	status: ConnectionStatus;
	/** Prescribed Cloud task branch from the resolved outer workspace, never the live checkout branch. */
	taskBranch?: string;
	/** Exact inner Hub session once resume/create has resolved it. */
	sessionId?: string;
}

/**
 * Overridable seams. `createHandle` is the injection point tests use to point the
 * controller at a `startTestHub` instance (or a droppable transport); production
 * leaves it unset and the descriptor drives {@link createLocalSessionHandle}.
 */
export interface SessionConnectionControllerDeps {
	createHandle?: (descriptor: ConnectionDescriptor) => Promise<SessionHandle>;
	onDiagnostic?: (diagnostic: SessionDiagnostic) => void;
	/** Passed through to the default local handle factory (tests inject drops). */
	WebSocketImpl?: WebSocketCtor;
	/** Workspace passed through to the default local handle factory. */
	workspaceRoot?: string;
	/** Ignore existing inner sessions and create one lazily on the first send. */
	createNewSession?: boolean;
	/**
	 * Resolves the raw Cline JWT for the cloud path. Required to connect a
	 * `mode: "cloud"` descriptor; local connections ignore it. Backed by
	 * `ClineAuthStore.getValidAccessToken` in a device build.
	 */
	getAccessToken?: () => Promise<string | null>;
	/**
	 * Per-tier auto-approve configuration (see {@link ApprovalPolicy}). Omitted
	 * means every tier asks, which is what the test suite and any caller that has
	 * not loaded the user's settings yet should get; the app passes the persisted
	 * policy and updates it through {@link
	 * SessionConnectionController.setApprovalPolicy}. Applies only to computer
	 * sessions; Cloud approvals follow the shared runtime's policy.
	 */
	approvalPolicy?: ApprovalPolicy;
	/** Keep settings current while this controller is retained off screen. */
	subscribeApprovalPolicy?(
		listener: (policy: ApprovalPolicy) => void,
	): () => void;
}

const INITIAL_VIEW: SessionViewModel = selectViewModel(createSessionState());

/**
 * The idle snapshot for a not-yet-started controller. Pure and side-effect free
 * so a caller (the hook's initial render) can seed state without constructing a
 * controller — building one just for a snapshot would risk a second HubClient.
 */
export function initialSnapshot(): ConnectionSnapshot {
	return { view: INITIAL_VIEW, status: { phase: "connecting" } };
}

import type { ReasoningChoice } from "@/session/reasoning";
export class SessionConnectionController {
	private reasoningChoice?: ReasoningChoice;
	private reasoningInitialized = false;
	setReasoningChoice = (choice: ReasoningChoice | undefined): void => {
		this.reasoningInitialized = true;
		this.reasoningChoice = choice;
		this.publish();
	};
	private taskBranch?: string;
	private connection: SessionConnection | undefined;
	private unsubscribeView: (() => void) | undefined;
	private status: ConnectionStatus = { phase: "connecting" };
	private view: SessionViewModel = INITIAL_VIEW;
	private snapshot: ConnectionSnapshot = {
		view: this.view,
		status: this.status,
	};
	private readonly listeners = new Set<() => void>();
	private bootstrap: Promise<void> | undefined;
	/**
	 * Whether {@link bootstrap} is still running. `bootstrap` itself is kept after
	 * it settles (so `start()` stays idempotent), so its presence alone cannot tell
	 * a retry whether there is anything to join.
	 */
	private bootstrapInFlight = false;
	private disposed = false;
	private readonly abortController = new AbortController();
	/**
	 * Latest policy. Held here as well as on the connection because a settings
	 * change can land before `bootstrapConnection` has built one.
	 */
	private approvalPolicy: ApprovalPolicy | undefined;
	private readonly unsubscribeApprovalPolicy?: () => void;

	constructor(
		private readonly descriptor: ConnectionDescriptor,
		private readonly deps: SessionConnectionControllerDeps = {},
		private initialHandle?: SessionHandle,
	) {
		this.approvalPolicy =
			descriptor.mode === "local" ? deps.approvalPolicy : undefined;
		if (descriptor.mode === "local") {
			this.unsubscribeApprovalPolicy = deps.subscribeApprovalPolicy?.(
				this.setApprovalPolicy,
			);
		}
	}

	/** React's `useSyncExternalStore` subscribe. */
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** React's `useSyncExternalStore` getSnapshot. Reference-stable per state. */
	getSnapshot = (): ConnectionSnapshot => this.snapshot;

	/** Builds the handle + connection and runs the connect/hydrate handshake. */
	start = (): Promise<void> => {
		if (this.disposed) {
			return Promise.resolve();
		}
		if (this.bootstrap) {
			return this.bootstrap;
		}
		this.setStatus({ phase: "connecting" });
		this.bootstrapInFlight = true;
		this.bootstrap = this.bootstrapConnection().finally(() => {
			this.bootstrapInFlight = false;
		});
		return this.bootstrap;
	};

	sendInput = async (
		text: string,
		attachments: SessionInputAttachments = {},
	): Promise<void> => {
		try {
			const connection = await this.requireConnection();
			await connection.sendInput(text, attachments);
		} catch {
			// Non-fatal. A hub command failure is already surfaced by the session core
			// (a failed message bubble + a `command_failed` diagnostic) and a bootstrap
			// failure by `status.phase === "error"`; swallow the rejection so it cannot
			// escape to the UI as an unhandled promise — on device that is a redbox.
		}
	};

	retrySend = async (messageId: string): Promise<void> => {
		try {
			const connection = await this.requireConnection();
			await connection.retrySend(messageId);
		} catch {
			// Non-fatal — see `sendInput`.
		}
	};

	abort = async (reason?: string): Promise<void> => {
		// Stop has an explicit pending/error surface, like approval responses.
		const connection = await this.requireConnection();
		await connection.abort(reason);
	};

	removePendingPrompt = async (promptId: string): Promise<void> => {
		const connection = await this.requireConnection();
		await connection.removePendingPrompt(promptId);
	};

	updatePendingPrompt = async (
		promptId: string,
		changes: { prompt?: string; delivery?: "queue" | "steer" },
	): Promise<void> => {
		const connection = await this.requireConnection();
		await connection.updatePendingPrompt(promptId, changes);
	};

	/** Change the model used by this exact live session. Errors reach the picker. */
	updateModel = async (
		modelId: string,
		options?: { providerId?: string },
	): Promise<void> => {
		const connection = await this.requireConnection();
		await connection.updateModel(modelId, options);
	};

	listCheckpoints = async () => {
		if (this.descriptor.mode !== "local") return [];
		return (await this.requireConnection()).listCheckpoints();
	};

	forkAtCheckpoint = async (runCount: number) => {
		if (this.descriptor.mode !== "local")
			throw new Error("Checkpoint forks are available for computer sessions.");
		const connection = await this.requireConnection();
		const input = await connection.prepareCheckpointFork(runCount);
		const descriptor = { ...this.descriptor };
		delete descriptor.hubSessionId;
		delete descriptor.pendingInitialMessage;
		delete descriptor.allowInitialCreate;
		delete descriptor.reasoning;
		const handle = await this.buildHandle(descriptor, true);
		try {
			if (!handle.adoptSession || !handle.needsCreate)
				throw new Error(
					"A separate connection is required to fork this conversation.",
				);
			if (this.disposed)
				throw new Error("The original conversation was closed.");
			await handle.client.command(
				"session.attach",
				{ sessionId: input.sessionId },
				input.sessionId,
			);
			const reply = await handle.client.command(
				"session.restore",
				input,
				input.sessionId,
			);
			const parsed = parseSessionCreateReply(reply.payload);
			if (parsed.status !== "ok" || parsed.sessionId === input.sessionId)
				throw new Error(
					"Cline did not return a new conversation for this checkpoint.",
				);
			if (this.disposed)
				throw new Error("The original conversation was closed.");
			handle.adoptSession(asHubSessionId(parsed.sessionId));
			const forkDescriptor = { ...descriptor, hubSessionId: parsed.sessionId };
			const controller = new SessionConnectionController(
				forkDescriptor,
				{
					...this.deps,
					approvalPolicy: this.approvalPolicy,
					createNewSession: false,
				},
				handle,
			);
			// Creation already succeeded. Keep its exact ID and recoverable error
			// state if hydration fails, so retrying the screen cannot fork twice.
			await controller.start().catch(() => {});
			return {
				descriptor: forkDescriptor,
				controller,
				sessionId: parsed.sessionId,
			};
		} catch (error) {
			handle.client.close();
			throw error;
		}
	};

	/** The connected machine's model catalog. Errors reach the picker. */
	listModelCatalog = async (): Promise<ModelCatalogView> => {
		const connection = await this.requireConnection();
		return await connection.listModelCatalog();
	};

	respondApproval = async (
		approvalId: string,
		approved: boolean,
		reason?: string,
	): Promise<void> => {
		const connection = await this.requireConnection();
		// The sheet owns this user action and has an inline retry surface. Let the
		// rejection reach it instead of making a failed response look accepted.
		await connection.respond(approvalId, approved, reason);
	};

	/** Answer a Cline `ask_question` request owned by this mobile-created session. */
	respondQuestion = async (
		requestId: string,
		answer: string,
	): Promise<void> => {
		const connection = await this.requireConnection();
		await connection.respondQuestion(requestId, answer);
	};

	/**
	 * Push a new auto-approve policy at the live session.
	 *
	 * Called when the user flips a tier in Settings. Safe before the connection
	 * exists: the value is remembered and applied when it is built.
	 */
	setApprovalPolicy = (policy: ApprovalPolicy): void => {
		// Cloud sessions are shared across clients. Device preferences must not
		// answer a runtime ask on attach, reconnect, or a background settings update.
		if (this.descriptor.mode !== "local") return;
		this.approvalPolicy = policy;
		this.connection?.setApprovalPolicy(policy);
	};

	/**
	 * User-driven retry. If the socket is up this is a resync; if the initial
	 * connect failed (or we were torn down) it rebuilds from scratch.
	 *
	 * Never rejects. The UI wires this straight to a Button press that discards the
	 * promise, so an escaping rejection is an on-device redbox; failures land in
	 * `status` instead, the same contract as `sendInput`/`respondApproval`.
	 */
	private idleRecovery?: Promise<void>;
	private recoveryDescriptor?: ConnectionDescriptor;
	private preserveRecoveryView = false;

	/** Refresh missed foreground activity; replace an unresponsive socket once. */
	recoverFromIdle = (): Promise<void> => {
		if (this.disposed || this.descriptor.mode !== "cloud")
			return Promise.resolve();
		this.idleRecovery ??= this.recoverCloudSession().finally(() => {
			this.idleRecovery = undefined;
		});
		return this.idleRecovery;
	};

	/** Lightweight liveness check while a Cloud chat remains foregrounded. */
	checkHealth = (): Promise<void> => {
		if (this.disposed || this.descriptor.mode !== "cloud")
			return Promise.resolve();
		this.idleRecovery ??= this.recoverCloudSession(true).finally(() => {
			this.idleRecovery = undefined;
		});
		return this.idleRecovery;
	};

	private async recoverCloudSession(probeOnly = false): Promise<void> {
		if (this.bootstrapInFlight) {
			await this.bootstrap?.catch(() => {});
			return;
		}
		const connection = this.connection;
		if (!connection && this.recoveryDescriptor && !this.disposed) {
			// A failed replacement has already been retired. A later foreground or
			// health tick may retry that pinned conversation, never initial creation.
			this.bootstrap = undefined;
			this.preserveRecoveryView = true;
			await this.start().catch(() => {});
			return;
		}
		const sessionId = connection?.handle.hubSessionId;
		// Initial provisioning/creation has its own recovery. Never turn a foreground
		// refresh into creating a new conversation or replaying its first prompt.
		if (!connection || !sessionId || this.disposed) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				probeOnly
					? connection.handle.client
							.command("session.get", { sessionId }, sessionId, {
								timeoutMs: 5_000,
							})
							.then((reply) => {
								const parsed = parseSessionRecordReply(reply.payload);
								if (parsed.status !== "ok" || parsed.sessionId !== sessionId)
									throw new Error(
										"Cloud session health reply did not match the conversation.",
									);
							})
					: connection.resync({ requireAttach: true, requireHydrate: true }),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("Cloud session refresh timed out.")),
						5_000,
					);
				}),
			]);
			if (!this.disposed && !probeOnly) this.setStatus({ phase: "ready" });
			return;
		} catch {
			if (this.disposed || this.connection !== connection) return;
		} finally {
			if (timer) clearTimeout(timer);
		}
		this.recoveryDescriptor = {
			...this.descriptor,
			remoteSessionId: connection.handle.remoteSession.id,
			hubSessionId: sessionId,
			allowInitialCreate: false,
		};
		delete this.recoveryDescriptor.pendingInitialMessage;
		this.unsubscribeView?.();
		this.unsubscribeView = undefined;
		connection.dispose();
		this.connection = undefined;
		this.bootstrap = undefined;
		this.preserveRecoveryView = true;
		await this.start().catch(() => {});
	}

	reconnect = async (): Promise<void> => {
		if (this.idleRecovery) return this.idleRecovery;
		if (this.disposed) {
			return;
		}
		// A tap that lands while the first bootstrap is still running joins it rather
		// than racing a second one. Clearing the latch and calling `start()` again
		// built a whole second HubClient and socket for one descriptor — both feeding
		// `setView`, only the last of them ever disposed — because `this.connection`
		// is not assigned until the handle resolves.
		if (this.bootstrapInFlight && this.bootstrap) {
			await this.bootstrap.catch(() => {
				// Reported through `status` by `bootstrapConnection`.
			});
			if (this.disposed || this.connection) {
				return;
			}
			// The joined bootstrap failed and left nothing behind: fall through and
			// rebuild from scratch.
		}
		if (
			this.descriptor.mode === "cloud" &&
			this.view.connectionStatus === "closed"
		) {
			this.unsubscribeView?.();
			this.unsubscribeView = undefined;
			this.connection?.dispose();
			this.connection = undefined;
		}

		if (this.connection) {
			try {
				// A user explicitly retrying an exact resume must not be marked ready if
				// attach is still refused. Background transport resyncs remain tolerant.
				await this.connection.resync({
					requireAttach: true,
					requireHydrate: this.descriptor.mode === "cloud",
				});
				if (!this.disposed) {
					// Without this a successful recovery from a `SessionAttachError` left
					// the user on the error screen with a working session behind it.
					this.setStatus({ phase: "ready" });
				}
			} catch (error) {
				if (!this.disposed) {
					this.setStatus({
						phase: "error",
						error:
							error instanceof Error
								? error
								: new Error(
										userErrorMessage(error, "Session connection failed."),
									),
					});
				}
			}
			return;
		}
		this.bootstrap = undefined;
		await this.start().catch(() => {
			// Already surfaced as `status.phase === "error"`.
		});
	};

	dispose = (): void => {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.unsubscribeApprovalPolicy?.();
		this.abortController.abort();
		this.unsubscribeView?.();
		this.unsubscribeView = undefined;
		this.initialHandle?.client.close();
		this.initialHandle = undefined;
		this.connection?.dispose();
		this.connection = undefined;
		this.setStatus({ phase: "closed" });
	};

	// --- internals -------------------------------------------------------------

	private async bootstrapConnection(): Promise<void> {
		try {
			// Yield once before building anything. React Strict Mode mounts, unmounts
			// and remounts synchronously; this lets the throwaway first mount's
			// `dispose()` land before we ever construct a HubClient, so a descriptor
			// lifecycle opens exactly one client instead of a leaked, connected pair.
			await Promise.resolve();
			if (this.disposed) {
				return;
			}
			const adoptedHandle = this.initialHandle;
			this.initialHandle = undefined;
			const handle = adoptedHandle ?? (await this.buildHandle());
			if (this.disposed) {
				handle.client.close();
				return;
			}
			this.taskBranch =
				this.descriptor.mode === "cloud"
					? cloudTaskBranch(
							handle.remoteSession.taskId,
							handle.remoteSession.id,
						)
					: undefined;
			// Saved defaults belong only to a newly created conversation. An existing
			// session may have been changed by another client since this device saved it.
			if (!this.reasoningInitialized) {
				this.reasoningInitialized = true;
				if (handle.needsCreate)
					this.reasoningChoice = this.descriptor.reasoning;
			}
			const connection = new SessionConnection({
				handle,
				getReasoningChoice: () => this.reasoningChoice,
				onReasoningApplied: (choice) => {
					// A newer edit made during the request still needs to be sent.
					if (
						this.connection === connection &&
						this.reasoningChoice === choice
					) {
						this.reasoningChoice = undefined;
						this.publish();
					}
				},
				...(this.approvalPolicy ? { approvalPolicy: this.approvalPolicy } : {}),
				...(this.deps.onDiagnostic
					? { onDiagnostic: this.deps.onDiagnostic }
					: {}),
			});
			this.connection = connection;
			let publishView = !this.preserveRecoveryView;
			this.unsubscribeView = connection.subscribe((view) => {
				if (publishView) this.setView(view);
			});
			if (publishView) this.setView(connection.getView());
			await connection.start({
				requireHydrate:
					this.preserveRecoveryView || this.descriptor.mode === "cloud",
			});
			publishView = true;
			this.preserveRecoveryView = false;
			if (this.disposed) {
				return;
			}
			this.setView(connection.getView());
			this.setStatus({ phase: "ready" });
		} catch (error) {
			if (this.disposed) {
				return;
			}
			if (this.preserveRecoveryView) {
				this.unsubscribeView?.();
				this.unsubscribeView = undefined;
				this.connection?.dispose();
				this.connection = undefined;
			}
			console.error("[mobile/session] connection failed", {
				mode: this.descriptor.mode,
				name: error instanceof Error ? error.name : typeof error,
				message: userErrorMessage(error, "Session connection failed."),
			});
			this.setStatus({
				phase: "error",
				error:
					error instanceof Error
						? error
						: new Error(userErrorMessage(error, "Session connection failed.")),
			});
			throw error;
		}
	}

	private async buildHandle(
		descriptor = this.recoveryDescriptor ?? this.descriptor,
		createNewSession = this.recoveryDescriptor
			? false
			: this.deps.createNewSession,
	): Promise<SessionHandle> {
		if (this.deps.createHandle) {
			return this.deps.createHandle(descriptor);
		}
		if (descriptor.mode === "cloud") {
			return this.buildCloudHandle(descriptor, createNewSession);
		}
		// A paired connection brings its own socket, because the credential is a
		// Noise handshake rather than something that fits in a header. Both kinds
		// authenticate before `HubClient` sees an open socket, so it sends no hub
		// credential of its own (`authMode: "none"`).
		const transport = await resolveLocalTransport(descriptor, {
			...(this.deps.getAccessToken
				? { getAccessToken: this.deps.getAccessToken }
				: {}),
			...(this.deps.WebSocketImpl
				? { WebSocketImpl: this.deps.WebSocketImpl }
				: {}),
		});
		return await createLocalSessionHandle({
			url: descriptor.url,
			authMode: transport.authMode,
			...(descriptor.hubSessionId
				? { hubSessionId: descriptor.hubSessionId }
				: {}),
			...(transport.authToken ? { authToken: transport.authToken } : {}),
			...(this.deps.workspaceRoot
				? { workspaceRoot: this.deps.workspaceRoot }
				: {}),
			...(descriptor.providerId ? { providerId: descriptor.providerId } : {}),
			...(descriptor.modelId ? { modelId: descriptor.modelId } : {}),
			...(createNewSession ? { createNewSession: true } : {}),
			...(transport.WebSocketImpl
				? { WebSocketImpl: transport.WebSocketImpl }
				: {}),
			...(this.deps.onDiagnostic
				? { onDiagnostic: this.deps.onDiagnostic }
				: {}),
		});
	}

	/**
	 * Builds a cloud handle from the descriptor's cloud fields. The Cline JWT
	 * comes from `deps.getAccessToken` (never from the descriptor, which is
	 * persisted); `apiBaseUrl` falls back to the build-time cloud environment.
	 */
	private buildCloudHandle(
		descriptor: ConnectionDescriptor,
		createNewSession?: boolean,
	): Promise<SessionHandle> {
		const getAccessToken = this.deps.getAccessToken;
		if (!getAccessToken) {
			return Promise.reject(
				new Error(
					"Cloud connect requires deps.getAccessToken (a signed-in Cline token).",
				),
			);
		}
		let resuming = false;
		return createCloudSessionHandle({
			allowInitialCreate: descriptor.allowInitialCreate === true,
			signal: this.abortController.signal,
			onProgress: (progress) => {
				resuming ||= progress.phase === "resuming";
				if (!this.disposed)
					this.setStatus({
						phase: "connecting",
						progress: cloudStartStatus(progress.phase, resuming),
					});
			},
			apiBaseUrl: descriptor.apiBaseUrl ?? cloudEnv.apiBaseUrl,
			getAccessToken,
			...(descriptor.modelId ? { modelId: descriptor.modelId } : {}),
			...(descriptor.hubSessionId
				? { hubSessionId: descriptor.hubSessionId }
				: {}),
			...(descriptor.remoteSessionId
				? {
						remoteSessionId: asRemoteSessionId(descriptor.remoteSessionId),
					}
				: {}),
			...(descriptor.organizationId
				? { organizationId: descriptor.organizationId }
				: {}),
			...(createNewSession ? { createNewSession: true } : {}),
			...(this.deps.WebSocketImpl
				? { WebSocketImpl: this.deps.WebSocketImpl }
				: {}),
			...(this.deps.onDiagnostic
				? { onDiagnostic: this.deps.onDiagnostic }
				: {}),
		});
	}

	private async requireConnection(): Promise<SessionConnection> {
		await this.idleRecovery;
		await this.start().catch(() => {
			// Surface the bootstrap failure as the more specific error below.
		});
		if (!this.connection) {
			throw new Error(
				this.status.error?.message ?? "Session connection is not available.",
			);
		}
		return this.connection;
	}

	private setStatus(status: ConnectionStatus): void {
		this.status = status;
		this.publish();
	}

	private setView(view: SessionViewModel): void {
		this.view = view;
		this.publish();
	}

	private publish(): void {
		const sessionId =
			this.connection?.handle.hubSessionId ??
			this.recoveryDescriptor?.hubSessionId;
		this.snapshot = {
			view: this.view,
			status: this.status,
			pendingReasoning: this.reasoningChoice,
			...(this.taskBranch ? { taskBranch: this.taskBranch } : {}),
			...(sessionId ? { sessionId } : {}),
		};
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				// A subscriber fault must not stop the stream.
			}
		}
	}
}
