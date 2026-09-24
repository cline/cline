import { randomUUID } from "node:crypto";
import type { CoreSessionEvent } from "@cline/core";
import {
	type CloudBranchListOptions,
	type CloudBranchListResult,
	type CloudCreationOptions,
	CloudHandoffCoordinator,
	type CloudHandoffProgress,
	type CloudHandoffSource,
	type CloudRepositoryListResult,
	CloudSessionApi,
	CloudSessionController,
	CloudSessionError,
	type CloudSessionRecord,
	type CloudSessionSnapshot,
	type CreateCloudSessionInput,
	createHubEventProjector,
	type HubEventProjector,
	loadCloudModels,
	type PreparedCloudHandoff,
} from "@cline/core/cloud";
import {
	getClineEnvironmentConfig,
	type MessageWithMetadata,
} from "@cline/shared";
import {
	type CloudIdentity,
	cloudCredentialKey,
	cloudTokenSubject,
	resolveCloudIdentity,
	resolveCloudToken,
} from "./auth";
import { CloudEligibility, type CloudEligibilityState } from "./eligibility";
import {
	type CloudCreationRecord,
	CloudCreationStore,
	type CloudScope,
	cloudScopeKey,
} from "./storage";

export type ExecutionTarget =
	| { kind: "local"; sessionId: string }
	| { kind: "cloud"; sessionId: string; scopeKey: string };
export type CloudRuntimeState = {
	eligibility: CloudEligibilityState;
	scope?: CloudScope;
	accountLabel?: string;
	organizationLabel?: string;
	target?: Extract<ExecutionTarget, { kind: "cloud" }>;
	session?: CloudSessionSnapshot;
	pendingCreations: CloudCreationRecord[];
	creating: boolean;
	stopping: boolean;
	handoffProgress?: CloudHandoffProgress;
	error?: string;
	dashboardUrl: string;
};
export type CloudTranscriptEvent =
	| {
			type: "snapshot";
			target: NonNullable<CloudRuntimeState["target"]>;
			snapshot: CloudSessionSnapshot;
	  }
	| {
			type: "core_event";
			target: NonNullable<CloudRuntimeState["target"]>;
			event: CoreSessionEvent;
	  };
type Clients = {
	api: CloudSessionApi;
	controller: CloudSessionController;
	pendingInitialTasks: Map<string, CloudCreationOptions>;
};

function isDefinitelyRejectedCreate(error: unknown): boolean {
	if (!(error instanceof CloudSessionError)) return false;
	return (
		(error.status !== undefined &&
			error.status >= 400 &&
			error.status < 500 &&
			error.status !== 408 &&
			error.status !== 409) ||
		[
			"authentication_required",
			"github_not_connected",
			"session_not_found",
			"session_expired",
		].includes(error.code)
	);
}
export type CliCloudRuntimeOptions = {
	handoffSource?: () => CloudHandoffSource | undefined;
	eligibility?: CloudEligibility;
	store?: CloudCreationStore;
	resolveIdentity?: () => Promise<CloudIdentity | undefined>;
	getToken?: () => Promise<string | undefined>;
	createClients?: (input: {
		scope: CloudScope;
		getAuthToken: () => Promise<string | undefined>;
		pendingInitialTasks: Map<string, CloudCreationOptions>;
	}) => Promise<Omit<Clients, "pendingInitialTasks">>;
};

/** Cloud commands never enter the local session runtime or prompt expansion pipeline. */
export class CliCloudRuntime {
	private readonly eligibility: CloudEligibility;
	private readonly store: CloudCreationStore;
	private state: CloudRuntimeState;
	private listeners = new Set<() => void>();
	private transcriptListeners = new Set<
		(event: CloudTranscriptEvent) => void
	>();
	private projector?: HubEventProjector;
	private identity?: CloudIdentity;
	private epoch = 0;
	private navigation = 0;
	private identityRequest = 0;
	private identityPending?: Promise<void>;
	private clients?: Clients;
	private authorizeClient?: () => Promise<string | undefined>;
	private clientsPending?: Promise<Clients>;
	private unsubscribeClient?: () => void;
	private unsubscribeEligibility: () => void;
	private timer?: ReturnType<typeof setInterval>;
	private disposed = false;
	private initialized?: Promise<void>;
	private activeCreation?: CloudCreationRecord;
	private inFlightCreations = new Set<string>();
	private stopPending?: Promise<void>;
	constructor(private readonly options: CliCloudRuntimeOptions = {}) {
		this.eligibility = options.eligibility ?? new CloudEligibility();
		this.store = options.store ?? new CloudCreationStore();
		this.state = {
			eligibility: this.eligibility.getSnapshot(),
			pendingCreations: [],
			creating: false,
			stopping: false,
			dashboardUrl: `${getClineEnvironmentConfig().appBaseUrl}/dashboard`,
		};
		this.unsubscribeEligibility = this.eligibility.subscribe(() => {
			const eligibility = this.eligibility.getSnapshot();
			if (this.state.eligibility.enabled && !eligibility.enabled) {
				this.detach();
				this.closeClients();
			}
			this.publish({ eligibility });
		});
	}
	getSnapshot = (): CloudRuntimeState => this.state;
	subscribeToSessionEvents = (
		listener: (event: CloudTranscriptEvent) => void,
	): (() => void) => {
		this.transcriptListeners.add(listener);
		if (this.state.target && this.state.session)
			listener({
				type: "snapshot",
				target: this.state.target,
				snapshot: this.state.session,
			});
		return () => this.transcriptListeners.delete(listener);
	};
	private emitTranscript(event: CloudTranscriptEvent): void {
		for (const listener of this.transcriptListeners) listener(event);
	}
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	private publish(patch: Partial<CloudRuntimeState>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener();
	}
	private fail(error: unknown): never {
		const message = error instanceof Error ? error.message : String(error);
		this.publish({ error: message });
		throw error;
	}
	initialize(): Promise<void> {
		return (this.initialized ??= (async () => {
			await this.refreshIdentity().catch(() => {});
			if (this.disposed) return;
			this.timer = setInterval(
				() => void this.refreshIdentity().catch(() => {}),
				60_000,
			);
			this.timer.unref?.();
		})());
	}
	refreshIdentity(): Promise<void> {
		if (this.identityPending) return this.identityPending;
		const request = ++this.identityRequest;
		const pending = this.resolveIdentity(request).finally(() => {
			if (this.identityPending === pending) this.identityPending = undefined;
		});
		this.identityPending = pending;
		return pending;
	}
	private async resolveIdentity(request: number): Promise<void> {
		let identity: CloudIdentity | undefined;
		try {
			identity = await (this.options.resolveIdentity ?? resolveCloudIdentity)();
		} catch (error) {
			if (this.disposed) return;
			if (request !== this.identityRequest)
				throw new Error(
					"Cloud account check was superseded. Retry in the current account.",
				);
			this.publish({
				error: error instanceof Error ? error.message : String(error),
			});
			// A failed account lookup is not a logout. Keep the viewer attached,
			// but fail operations that require a fresh scope (especially creation).
			throw error;
		}
		if (this.disposed) return;
		if (request !== this.identityRequest)
			throw new Error(
				"Cloud account check was superseded. Retry in the current account.",
			);
		const oldKey = this.identity && cloudScopeKey(this.identity.scope);
		const nextKey = identity && cloudScopeKey(identity.scope);
		if (
			oldKey !== nextKey ||
			this.identity?.subject !== identity?.subject ||
			this.identity?.credentialKey !== identity?.credentialKey
		)
			await this.changeIdentity(identity);
		else if (identity) {
			this.identity = identity;
			this.publish({
				accountLabel: identity.accountLabel,
				organizationLabel: identity.organizationLabel,
				error: undefined,
			});
		}
		if (!this.disposed && request !== this.identityRequest)
			throw new Error(
				"Cloud account check was superseded. Retry in the current account.",
			);
	}

	/** Retire the old scope before an account-switch request can complete. */
	invalidateIdentity(): void {
		++this.identityRequest;
		this.identityPending = undefined;
		this.detach();
		this.closeClients();
		this.identity = undefined;
		this.publish({
			scope: undefined,
			accountLabel: undefined,
			organizationLabel: undefined,
			pendingCreations: [],
		});
		void this.eligibility.setScope(undefined);
	}
	private async changeIdentity(identity?: CloudIdentity): Promise<void> {
		this.detach();
		this.closeClients();
		++this.epoch;
		this.identity = identity;
		if (identity) {
			// A process restart retires every unsent start intent. Recovery is always explicit.
			for (const row of this.store.list(identity.scope))
				if (row.intent === "start_pending")
					this.save({ ...row, intent: "detached" });
		}
		this.publish({
			scope: identity?.scope,
			accountLabel: identity?.accountLabel,
			organizationLabel: identity?.organizationLabel,
			pendingCreations: identity ? this.store.list(identity.scope) : [],
			error: undefined,
		});
		await this.eligibility.setScope(identity?.scope);
	}
	private closeClients(): void {
		this.authorizeClient = undefined;
		this.projector?.dispose();
		this.projector = undefined;
		++this.epoch;
		this.unsubscribeClient?.();
		this.unsubscribeClient = undefined;
		const clients = this.clients;
		this.clients = undefined;
		this.clientsPending = undefined;
		void clients?.controller.dispose().catch(() => {});
	}
	private assertCurrent(epoch: number): void {
		if (this.disposed || epoch !== this.epoch)
			throw new Error(
				"Cloud account or connection changed. Reopen Cloud to continue.",
			);
		this.eligibility.assertEnabled();
	}
	private async ready(): Promise<Clients> {
		await this.refreshIdentity();
		this.eligibility.assertEnabled();
		if (this.clients) return this.clients;
		if (this.clientsPending) return this.clientsPending;
		const identity = this.identity;
		const epoch = this.epoch;
		if (!identity) throw new Error("Sign in to Cline to use cloud agents.");
		const getAuthToken = async () => {
			this.assertCurrent(epoch);
			const token = await (this.options.getToken ?? resolveCloudToken)();
			this.assertCurrent(epoch);
			if (
				!token ||
				(identity.subject && cloudTokenSubject(token) !== identity.subject) ||
				(identity.credentialKey &&
					cloudCredentialKey(token) !== identity.credentialKey)
			) {
				void this.changeIdentity(undefined);
				throw new Error(
					"Cline account changed. Sign in again before using Cloud.",
				);
			}
			return token;
		};
		const pending = (async () => {
			const pendingInitialTasks = new Map<string, CloudCreationOptions>();
			const createdClients = this.options.createClients
				? await this.options.createClients({
						scope: identity.scope,
						getAuthToken,
						pendingInitialTasks,
					})
				: (() => {
						const api = new CloudSessionApi({
							apiBaseUrl: identity.scope.apiBaseUrl,
							appBaseUrl: getClineEnvironmentConfig().appBaseUrl,
							getAuthToken,
						});
						return {
							api,
							controller: new CloudSessionController({
								api,
								pendingInitialTasks,
								apiBaseUrl: identity.scope.apiBaseUrl,
								getAuthToken,
								getActiveOrganizationId: async () => {
									this.assertCurrent(epoch);
									return identity.scope.organizationId;
								},
								lateCreateDisposition: "preserve",
								clientIdentity: {
									prefix: "cli-cloud",
									type: "cli",
									displayName: "Cline CLI",
									source: "cline-cli",
								},
							}),
						};
					})();
			const clients: Clients = { ...createdClients, pendingInitialTasks };
			try {
				this.assertCurrent(epoch);
			} catch (error) {
				await clients.controller.dispose();
				throw error;
			}
			this.projector = createHubEventProjector((event) => {
				const target = this.state.target;
				if (
					epoch === this.epoch &&
					target &&
					event.payload.sessionId === target.sessionId
				)
					this.emitTranscript({ type: "core_event", target, event });
			});
			this.clients = clients;
			this.authorizeClient = getAuthToken;
			this.unsubscribeClient = clients.controller.subscribe((event) => {
				if (
					epoch !== this.epoch ||
					event.sessionId !== this.state.target?.sessionId
				)
					return;
				if (event.type === "prompt_accepted") {
					for (const row of this.state.pendingCreations) {
						if (
							row.outerSessionId === event.sessionId &&
							row.intent === "delivery_unknown" &&
							row.prompt === event.prompt
						)
							this.save({
								...row,
								intent: "sent_confirmed",
								prompt: undefined,
							});
					}
					return;
				}
				if (event.type === "snapshot") {
					this.publish({ session: event.snapshot });
					if (event.replace && this.state.target) {
						this.projector?.reset(event.sessionId);
						this.emitTranscript({
							type: "snapshot",
							target: this.state.target,
							snapshot: event.snapshot,
						});
					}
				} else if (event.type === "hub_event") {
					if (event.event.event === "run.started" && this.state.target) {
						const snapshot = clients.controller.getSnapshot(event.sessionId);
						if (snapshot)
							this.emitTranscript({
								type: "snapshot",
								target: this.state.target,
								snapshot,
							});
					}
					this.projector?.handle(event.event);
				} else if (event.type === "sync_failed")
					this.publish({ error: event.message });
			});
			return clients;
		})().finally(() => {
			if (this.clientsPending === pending) this.clientsPending = undefined;
		});
		this.clientsPending = pending;
		return pending;
	}
	async list(): Promise<CloudSessionRecord[]> {
		return (await this.ready()).controller.list();
	}
	async listRepositories(): Promise<CloudRepositoryListResult> {
		return (await this.ready()).controller.listRepositories();
	}
	async listBranches(
		repositoryId: number,
		options?: CloudBranchListOptions,
	): Promise<CloudBranchListResult> {
		return (await this.ready()).controller.listBranches(repositoryId, options);
	}
	async models(): Promise<Array<{ id: string; name: string }>> {
		await this.ready();
		const epoch = this.epoch;
		const scope = this.identity!.scope;
		const models = await loadCloudModels(scope.apiBaseUrl, {
			isOrganizationSession: Boolean(scope.organizationId),
		});
		this.assertCurrent(epoch);
		return models;
	}

	hasHandoffSource(): boolean {
		return Boolean(this.options.handoffSource?.());
	}
	private async handoffCoordinator(): Promise<CloudHandoffCoordinator> {
		const clients = await this.ready();
		const source = this.options.handoffSource?.();
		if (!source)
			throw new Error(
				"Start a local conversation before handing it off to cloud.",
			);
		const epoch = this.epoch;
		return new CloudHandoffCoordinator({
			source,
			cloud: clients.controller,
			scopeKey: cloudScopeKey(this.identity!.scope),
			appBaseUrl: getClineEnvironmentConfig().appBaseUrl,
			assertAvailable: () => this.assertCurrent(epoch),
			models: async (isOrganizationSession) => {
				this.assertCurrent(epoch);
				const models = await loadCloudModels(this.identity!.scope.apiBaseUrl, {
					isOrganizationSession,
				});
				this.assertCurrent(epoch);
				return models;
			},
			recoverCreation: async (fingerprint, requestId) => {
				const record = await clients.api.recoverCreation({
					...fingerprint,
					requestId,
					organizationId: fingerprint.organizationId ?? null,
				});
				this.assertCurrent(epoch);
				return record?.id;
			},
			onProgress: (handoffProgress) => {
				this.assertCurrent(epoch);
				this.publish({ handoffProgress });
			},
		});
	}
	async prepareHandoff(): Promise<PreparedCloudHandoff> {
		return (await this.handoffCoordinator()).prepare();
	}
	async handoff(prepared: PreparedCloudHandoff): Promise<void> {
		if (this.state.creating)
			throw new Error("A cloud creation is already in progress.");
		this.publish({
			creating: true,
			handoffProgress: undefined,
			error: undefined,
		});
		try {
			const coordinator = await this.handoffCoordinator();
			const epoch = this.epoch;
			const navigation = this.navigation;
			const id = await coordinator.execute(prepared);
			this.assertCurrent(epoch);
			if (navigation === this.navigation) await this.attach(id);
		} catch (error) {
			this.fail(error);
		} finally {
			this.publish({ creating: false, handoffProgress: undefined });
		}
	}
	private save(row: CloudCreationRecord): void {
		this.store.save(row);
		if (this.activeCreation?.requestId === row.requestId)
			this.activeCreation = row;
		if (
			this.identity &&
			cloudScopeKey(row.scope) === cloudScopeKey(this.identity.scope)
		)
			this.publish({ pendingCreations: this.store.list(row.scope) });
	}
	private row(requestId: string): CloudCreationRecord {
		const row = this.state.pendingCreations.find(
			(item) => item.requestId === requestId,
		);
		if (!row) throw new Error("Cloud draft not found in this account.");
		return row;
	}
	private creationInput(
		row: CloudCreationRecord,
	): CreateCloudSessionInput & { requestId: string } {
		return {
			requestId: row.requestId,
			repoUrl: row.repoUrl,
			branch: row.branch,
			modelId: row.modelId,
			autoApproveTools: row.autoApproveTools,
			organizationId: row.scope.organizationId,
		};
	}
	async create(input: {
		repoUrl: string;
		branch?: string;
		modelId: string;
		prompt: string;
		autoApproveTools: boolean;
	}): Promise<void> {
		if (this.activeCreation || this.state.creating)
			throw new Error("A cloud session is already starting.");
		if (!input.prompt.trim() || !input.modelId.trim())
			throw new Error("Choose a model and enter a prompt.");
		const entryNavigation = this.navigation;
		const entryEpoch = this.epoch;
		const clients = await this.ready();
		this.assertCurrent(entryEpoch);
		if (entryNavigation !== this.navigation) return;
		const availableModels = await this.models();
		this.assertCurrent(entryEpoch);
		if (entryNavigation !== this.navigation) return;
		if (!availableModels.some((model) => model.id === input.modelId))
			throw new Error(
				"The selected cloud model is no longer available. Choose another model.",
			);
		if (this.state.creating)
			throw new Error("A cloud session is already starting.");
		this.detach();
		const navigation = this.navigation;
		const epoch = this.epoch;
		let row: CloudCreationRecord = {
			version: 1,
			requestId: randomUUID(),
			scope: this.identity!.scope,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			intent: "start_pending",
			initialTaskPending: true,
			...input,
			autoApproveTools: input.autoApproveTools === true,
		};
		this.activeCreation = row;
		this.inFlightCreations.add(row.requestId);
		this.save(row);
		this.publish({ creating: true, error: undefined });
		try {
			// Persist intent before POST. API create never sends the initial prompt.
			const created = await clients.api.create(this.creationInput(row));
			row = {
				...(this.store
					.list(row.scope)
					.find((item) => item.requestId === row.requestId) ?? row),
				outerSessionId: created.sessionId,
			};
			this.save(row);
			if (
				row.intent === "cancel_requested" ||
				row.intent === "cleanup_unknown"
			) {
				await this.cleanupCreation(row, clients.api);
				return;
			}
			if (
				navigation !== this.navigation ||
				epoch !== this.epoch ||
				row.intent !== "start_pending"
			) {
				this.save({ ...row, intent: "detached" });
				return;
			}
			this.assertCurrent(epoch);
			await this.attachWith(clients, created.sessionId, row, navigation, epoch);
			if (navigation !== this.navigation) return;
			await this.sendDraft(row, clients, epoch, navigation);
		} catch (error) {
			const current = this.store
				.list(row.scope)
				.find((item) => item.requestId === row.requestId);
			if (current?.intent === "start_pending") {
				if (isDefinitelyRejectedCreate(error)) {
					this.store.remove(current);
					if (
						this.identity &&
						cloudScopeKey(current.scope) === cloudScopeKey(this.identity.scope)
					) {
						this.publish({ pendingCreations: this.store.list(current.scope) });
					}
				} else {
					this.save({ ...current, intent: "detached" });
				}
			}
			if (epoch === this.epoch && navigation === this.navigation)
				this.fail(error);
		} finally {
			this.inFlightCreations.delete(row.requestId);
			if (this.activeCreation?.requestId === row.requestId)
				this.activeCreation = undefined;
			if (epoch === this.epoch && navigation === this.navigation)
				this.publish({ creating: false });
		}
	}
	async attach(id: string): Promise<void> {
		const navigation = this.navigation;
		const epoch = this.epoch;
		const clients = await this.ready();
		this.assertCurrent(epoch);
		if (navigation !== this.navigation) return;
		this.detach();
		const row = this.state.pendingCreations.find(
			(item) => item.outerSessionId === id,
		);
		await this.attachWith(clients, id, row, this.navigation, this.epoch);
	}
	private async attachWith(
		clients: Clients,
		id: string,
		row: CloudCreationRecord | undefined,
		navigation: number,
		epoch: number,
	): Promise<void> {
		this.assertCurrent(epoch);
		if (navigation !== this.navigation) return;
		this.publish({
			target: {
				kind: "cloud",
				sessionId: id,
				scopeKey: cloudScopeKey(this.identity!.scope),
			},
			error: undefined,
			session: undefined,
		});
		try {
			// Only an unsent creation recorded by this host may create its first task.
			if (
				row?.initialTaskPending === true &&
				(row.intent === "start_pending" || row.intent === "detached")
			) {
				clients.pendingInitialTasks.set(id, {
					autoApproveTools: row.autoApproveTools,
				});
			}
			const attachment = await clients.controller.attach(id, {
				autoApproveTools: row?.autoApproveTools === true,
			});
			this.assertCurrent(epoch);
			if (navigation !== this.navigation) {
				await clients.controller.detach(id);
				return;
			}
			if (attachment.status === "provisioning") {
				this.publish({ session: clients.controller.getSnapshot(id) });
				await clients.controller.waitUntilReady(id);
				this.assertCurrent(epoch);
				if (navigation !== this.navigation) return;
				await clients.controller.attach(id, {
					autoApproveTools: row?.autoApproveTools === true,
				});
				this.assertCurrent(epoch);
				if (navigation !== this.navigation) {
					await clients.controller.detach(id);
					return;
				}
			}
			await clients.controller.readMessages(id);
			this.assertCurrent(epoch);
			if (navigation !== this.navigation) return;
			if (row?.initialTaskPending && !clients.pendingInitialTasks.has(id)) {
				// The controller found an existing task; never recreate it if it disappears.
				this.save({ ...this.row(row.requestId), initialTaskPending: false });
			}
			this.publish({ session: clients.controller.getSnapshot(id) });
		} catch (error) {
			if (epoch === this.epoch && navigation === this.navigation)
				this.fail(error);
		}
	}
	private async sendDraft(
		row: CloudCreationRecord,
		clients: Clients,
		epoch: number,
		navigation: number,
	): Promise<void> {
		this.assertCurrent(epoch);
		if (navigation !== this.navigation || !row.outerSessionId || !row.prompt)
			return;
		// Record uncertain delivery BEFORE dispatch: a crash after acceptance must never auto-resend.
		row = { ...row, intent: "delivery_unknown", initialTaskPending: false };
		this.save(row);
		await clients.controller.send(row.outerSessionId!, row.prompt!);
		const current = this.store
			.list(row.scope)
			.find((item) => item.requestId === row.requestId);
		if (current?.intent === "delivery_unknown")
			this.save({ ...current, intent: "sent_confirmed", prompt: undefined });
	}
	private async active(): Promise<{ clients: Clients; id: string }> {
		const target = this.state.target;
		const navigation = this.navigation;
		if (!target) throw new Error("Open a cloud session first.");
		const clients = this.clients;
		if (!clients || !this.authorizeClient)
			throw new Error("Cloud connection is unavailable. Reopen the task.");
		// Existing task actions use fresh scoped credentials, without depending
		// on the account REST service being reachable to Stop or approve a tool.
		await this.authorizeClient();
		if (navigation !== this.navigation || this.state.target !== target)
			throw new Error("Cloud session changed.");
		return { clients, id: target.sessionId };
	}
	async send(text: string, delivery?: "queue" | "steer"): Promise<void> {
		if (!text.trim()) return;
		const { clients, id } = await this.active();
		try {
			for (const row of this.state.pendingCreations) {
				if (row.outerSessionId === id && row.initialTaskPending)
					this.save({ ...row, initialTaskPending: false });
			}
			await clients.controller.send(id, text, delivery);
		} catch (error) {
			this.fail(error);
		}
	}
	async respondApproval(approvalId: string, approved: boolean): Promise<void> {
		const { clients, id } = await this.active();
		await clients.controller.respondApproval(id, approvalId, { approved });
	}
	async updatePendingPrompt(
		promptId: string,
		prompt: string,
		delivery?: "queue" | "steer",
	): Promise<void> {
		const { clients, id } = await this.active();
		await clients.controller.updatePendingPrompt(id, promptId, {
			prompt,
			delivery,
		});
	}
	async removePendingPrompt(promptId: string): Promise<void> {
		const { clients, id } = await this.active();
		await clients.controller.removePendingPrompt(id, promptId);
	}
	stop(): Promise<void> {
		if (this.stopPending) return this.stopPending;
		this.publish({ stopping: true });
		const pending = (async () => {
			try {
				const { clients, id } = await this.active();
				await clients.controller.abort(id);
			} finally {
				this.publish({ stopping: false });
			}
		})().finally(() => {
			if (this.stopPending === pending) this.stopPending = undefined;
		});
		this.stopPending = pending;
		return pending;
	}
	detach(): void {
		++this.navigation;
		if (this.activeCreation?.intent === "start_pending")
			this.save({ ...this.activeCreation, intent: "detached" });
		this.activeCreation = undefined;
		const id = this.state.target?.sessionId;
		if (id) this.projector?.reset(id);
		this.publish({
			target: undefined,
			session: undefined,
			creating: false,
			stopping: false,
		});
		if (id) void this.clients?.controller.detach(id).catch(() => {});
	}
	async recover(requestId: string): Promise<void> {
		const existing = this.row(requestId);
		if (
			existing.intent === "cancel_requested" ||
			existing.intent === "cleanup_unknown"
		) {
			await this.cleanupCreation(existing);
			return;
		}
		const navigation = this.navigation;
		const epoch = this.epoch;
		const clients = await this.ready();
		this.assertCurrent(epoch);
		if (navigation !== this.navigation) return;
		let row = this.row(requestId);
		if (!row.outerSessionId) {
			const record = await clients.api.recoverCreation(this.creationInput(row));
			this.assertCurrent(epoch);
			if (navigation !== this.navigation) return;
			if (!record)
				throw new Error(
					"No matching session found yet. Retry recovery later or inspect the dashboard. No new session was created.",
				);
			row = { ...row, outerSessionId: record.id };
			this.save(row);
		}
		if (row.intent === "cancel_requested" || row.intent === "cleanup_unknown") {
			await this.cleanupCreation(row, clients.api);
			return;
		}
		await this.attach(row.outerSessionId!);
		if (
			row.intent === "delivery_unknown" &&
			promptPresent(this.state.session, row.prompt)
		)
			this.save({ ...row, intent: "sent_confirmed", prompt: undefined });
	}
	async resumeDraft(
		requestId: string,
		confirmDuplicateRisk = false,
	): Promise<void> {
		await this.recover(requestId);
		const row = this.row(requestId);
		if (row.intent === "sent_confirmed") return;
		if (["cancel_requested", "cleanup_unknown"].includes(row.intent))
			throw new Error("This draft was cancelled.");
		if (
			!row.outerSessionId ||
			this.state.target?.sessionId !== row.outerSessionId
		)
			return;
		if (row.intent === "delivery_unknown" && !confirmDuplicateRisk)
			throw new Error(
				"Delivery is unknown. Explicitly confirm duplicate risk before resending.",
			);
		if (!this.state.session?.transcriptKnown)
			throw new Error(
				"Wait for cloud transcript synchronization before sending the saved prompt.",
			);
		const { clients } = await this.active();
		await this.sendDraft(row, clients, this.epoch, this.navigation);
	}
	async cancelCreation(requestId: string): Promise<void> {
		const row = this.row(requestId);
		this.save({ ...row, intent: "cancel_requested" });
		if (this.state.target?.sessionId === row.outerSessionId) this.detach();
		if (row.outerSessionId)
			await this.cleanupCreation({ ...row, intent: "cancel_requested" });
		else if (!this.inFlightCreations.has(requestId))
			await this.recover(requestId);
	}
	private async cleanupCreation(
		row: CloudCreationRecord,
		existingApi?: CloudSessionApi,
	): Promise<void> {
		try {
			// A recorded cancellation is the sole rollout exception. It may only
			// recover/delete that creation using fresh auth in its original scope.
			const epoch = this.epoch;
			const identity = await (
				this.options.resolveIdentity ?? resolveCloudIdentity
			)();
			const scopeKey = cloudScopeKey(row.scope);
			const assertScope = () => {
				if (
					this.disposed ||
					epoch !== this.epoch ||
					!identity ||
					cloudScopeKey(identity.scope) !== scopeKey
				)
					throw new Error(
						"Return to the original account to finish cloud cleanup.",
					);
			};
			assertScope();
			const getAuthToken = async () => {
				assertScope();
				const token = await (this.options.getToken ?? resolveCloudToken)();
				assertScope();
				if (
					!token ||
					(identity?.subject &&
						cloudTokenSubject(token) !== identity.subject) ||
					(identity?.credentialKey &&
						cloudCredentialKey(token) !== identity.credentialKey)
				)
					throw new Error(
						"Sign in to the original account to finish cloud cleanup.",
					);
				return token;
			};
			// Production cleanup always uses one resolver scoped to the recorded
			// account, even when the interactive client's rollout gate was revoked.
			let api: CloudSessionApi;
			if (this.options.createClients) {
				const existing = existingApi ?? this.clients?.api;
				if (existing) api = existing;
				else {
					const clients = await this.options.createClients({
						scope: row.scope,
						getAuthToken,
						pendingInitialTasks: new Map(),
					});
					api = clients.api;
					await clients.controller.dispose();
				}
			} else {
				api = new CloudSessionApi({
					apiBaseUrl: row.scope.apiBaseUrl,
					appBaseUrl: getClineEnvironmentConfig().appBaseUrl,
					getAuthToken,
				});
			}
			if (!row.outerSessionId) {
				const found = await api.recoverCreation(this.creationInput(row));
				assertScope();
				if (!found)
					throw new Error(
						"Cancelled creation not found yet. Retry recovery later.",
					);
				row = { ...row, outerSessionId: found.id };
				this.save(row);
			}
			const token = await getAuthToken();
			if (!row.outerSessionId)
				throw new Error("Cloud cleanup has no session ID.");
			await api.delete(row.outerSessionId, token);
			this.store.remove(row);
			if (this.identity && cloudScopeKey(this.identity.scope) === scopeKey)
				this.publish({ pendingCreations: this.store.list(row.scope) });
		} catch (error) {
			this.save({ ...row, intent: "cleanup_unknown" });
			throw error;
		}
	}
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		++this.identityRequest;
		clearInterval(this.timer);
		this.detach();
		this.unsubscribeEligibility();
		const clients = this.clients;
		this.closeClients();
		await Promise.all([
			this.eligibility.dispose(),
			clients?.controller.dispose(),
		]);
		this.listeners.clear();
		this.transcriptListeners.clear();
	}
}

function promptPresent(
	snapshot: CloudSessionSnapshot | undefined,
	prompt?: string,
): boolean {
	if (!snapshot?.transcriptKnown || !prompt) return false;
	return (
		snapshot.promptsInQueue.some((item) => item.prompt === prompt) ||
		snapshot.messages.some(
			(message: MessageWithMetadata) =>
				message.role === "user" &&
				(typeof message.content === "string"
					? message.content
					: message.content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("")) === prompt,
		)
	);
}
