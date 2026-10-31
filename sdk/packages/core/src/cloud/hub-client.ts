import type { HubEventEnvelope, HubReplyEnvelope } from "@cline/shared";
import type { NodeHubClient } from "../hub/client";
import { CloudSessionError, type CloudSessionRecord } from "./api";
import type {
	CloudHubArgs,
	CloudHubOperation,
	CloudHubResult,
	CloudHubScope,
} from "./hub-protocol";
import { immutableCopy } from "./state";
import type {
	CloudSessionEvent,
	CloudSessionSnapshot,
	JsonRecord,
} from "./types";

export type CloudHubConnection = Pick<NodeHubClient, "command" | "subscribe">;
/** Transport facade for a hub-owned cloud controller. Disposing only releases this viewer. */
export class HubCloudSessionClient {
	private readonly snapshots = new Map<string, CloudSessionSnapshot>();
	private readonly records = new Map<string, JsonRecord>();
	private readonly listeners = new Set<(event: CloudSessionEvent) => void>();
	private unsubscribe?: () => void;
	private connection?: Promise<CloudHubConnection>;
	private disposed = false;
	private serviceId?: string;
	private scopeGeneration = -1;
	private revision = -1;
	private readonly sessionRevisions = new Map<string, number>();
	constructor(
		private readonly getConnection: () => Promise<CloudHubConnection>,
	) {}
	private async ready(): Promise<CloudHubConnection> {
		if (this.disposed) throw new Error("Cloud viewer is disposed");
		if (!this.connection) {
			const connecting = this.getConnection().then(async (client) => {
				if (this.disposed) throw new Error("Cloud viewer is disposed");
				this.unsubscribe = client.subscribe((envelope: HubEventEnvelope) => {
					if (envelope.event === "cloud.event") this.recover(envelope.payload);
				});
				try {
					const reply = await client.command("cloud.watch");
					this.checkReply(reply);
					this.recover(reply.payload);
					return client;
				} catch (error) {
					this.unsubscribe?.();
					this.unsubscribe = undefined;
					throw error;
				}
			});
			this.connection = connecting;
			void connecting.catch(() => {
				if (this.connection === connecting) this.connection = undefined;
			});
		}
		return this.connection;
	}
	async connect(): Promise<void> {
		await this.ready();
	}
	get scope(): CloudHubScope | undefined {
		return this.serviceId
			? { serviceId: this.serviceId, scopeGeneration: this.scopeGeneration }
			: undefined;
	}
	private recover(payload: Record<string, unknown> | undefined): void {
		if (this.disposed || !this.acceptVersion(payload)) return;
		const revision = Number(payload?.revision);
		if (Array.isArray(payload?.snapshots)) {
			const snapshots = payload.snapshots as CloudSessionSnapshot[];
			const present = new Set(snapshots.map((snapshot) => snapshot.sessionId));
			for (const sessionId of this.snapshots.keys()) {
				if (
					(!payload.sessionId || payload.sessionId === sessionId) &&
					!present.has(sessionId)
				)
					this.receive({ type: "removed", sessionId }, revision);
			}
			for (const snapshot of snapshots)
				this.receive(
					{
						type: "snapshot",
						sessionId: snapshot.sessionId,
						snapshot,
						replace: true,
					},
					revision,
				);
		} else this.receive(payload?.event as CloudSessionEvent, revision);
	}
	private acceptVersion(payload: Record<string, unknown> | undefined): boolean {
		if (
			typeof payload?.serviceId !== "string" ||
			typeof payload.revision !== "number"
		)
			return false;
		if (
			payload.serviceId === this.serviceId &&
			Number(payload.scopeGeneration) < this.scopeGeneration
		)
			return false;
		if (
			payload.serviceId !== this.serviceId ||
			payload.scopeGeneration !== this.scopeGeneration
		) {
			for (const sessionId of this.snapshots.keys())
				this.receive({ type: "removed", sessionId });
			this.records.clear();
			this.sessionRevisions.clear();
			this.serviceId = payload.serviceId;
			this.scopeGeneration = Number(payload.scopeGeneration);
			this.revision = -1;
		}
		this.revision = Math.max(this.revision, payload.revision);
		return true;
	}
	private checkReply(reply: HubReplyEnvelope): void {
		if (!reply.ok)
			throw new Error(reply.error?.message ?? "Cloud hub request failed");
	}
	private receive(event: CloudSessionEvent, revision = this.revision): void {
		if (this.disposed || !event) return;
		if (revision < (this.sessionRevisions.get(event.sessionId) ?? -1)) return;
		this.sessionRevisions.set(event.sessionId, revision);
		if (event.type === "snapshot")
			this.snapshots.set(event.sessionId, structuredClone(event.snapshot));
		if (event.type === "removed") {
			this.snapshots.delete(event.sessionId);
			this.records.delete(event.sessionId);
		}
		const delivered = immutableCopy(event);
		for (const listener of this.listeners) listener(delivered);
	}
	subscribe(listener: (event: CloudSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	protected async call<K extends CloudHubOperation>(
		operation: K,
		args: CloudHubArgs<K>,
		expectedScope?: CloudHubScope,
	): Promise<CloudHubResult<K>> {
		// Capture an established viewer's scope before yielding to connection recovery.
		const preparedScope = expectedScope ? { ...expectedScope } : this.scope;
		const client = await this.ready();
		if (this.disposed) throw new Error("Cloud viewer is disposed");
		const scope = preparedScope ?? {
			serviceId: this.serviceId,
			scopeGeneration: this.scopeGeneration,
		};
		const isCurrentScope = () =>
			scope.serviceId === this.serviceId &&
			scope.scopeGeneration === this.scopeGeneration;
		let dispatched = false;
		const reply = await client
			.command("cloud.command", { operation, args, scope }, undefined, {
				timeoutMs: ["create", "send", "attach"].includes(operation)
					? null
					: undefined,
				beforeDispatch: () => {
					if (this.disposed) throw new Error("Cloud viewer is disposed");
					if (!isCurrentScope())
						throw new Error("Cloud account changed before request");
					if (dispatched)
						throw new Error(
							"Cloud request outcome is unknown; reconnect before retrying",
						);
				},
				onDispatch: () => {
					dispatched = true;
				},
			})
			.catch((error: unknown) => {
				// Cloud and Hub entrypoints bundle separate error constructors.
				const rejected =
					error instanceof Error &&
					error.name === "HubCommandError" &&
					"code" in error &&
					error.code !== "hub_command_timeout";
				if (
					operation === "create" &&
					typeof args[0] === "object" &&
					args[0] !== null &&
					"initialMessage" in args[0] &&
					args[0].initialMessage !== undefined &&
					dispatched &&
					!rejected
				)
					throw new CloudSessionError(
						"request_failed",
						"The cloud task may have started. Check your cloud tasks before submitting this draft again.",
					);
				throw error;
			});
		this.checkReply(reply);
		if (
			!isCurrentScope() ||
			reply.payload?.serviceId !== scope.serviceId ||
			reply.payload?.scopeGeneration !== scope.scopeGeneration ||
			!this.acceptVersion(reply.payload)
		)
			throw new Error("Cloud account changed during request");
		if (this.disposed) throw new Error("Cloud viewer is disposed");
		return reply.payload?.result as CloudHubResult<K>;
	}
	create(
		input: CloudHubArgs<"create">[0],
		scope?: CloudHubScope,
	): Promise<CloudHubResult<"create">> {
		return this.call("create", [input], scope);
	}
	attach(...args: CloudHubArgs<"attach">): Promise<CloudHubResult<"attach">> {
		return this.call("attach", args);
	}
	send(...args: CloudHubArgs<"send">): Promise<CloudHubResult<"send">> {
		return this.call("send", args);
	}
	prepareHandoffRepository(
		repoUrl: string,
		scope?: CloudHubScope,
	): Promise<CloudHubResult<"prepareHandoffRepository">> {
		return this.call("prepareHandoffRepository", [repoUrl], scope);
	}
	refreshOrganization(): Promise<void> {
		return this.call("refreshOrganization", []);
	}
	abort(...args: CloudHubArgs<"abort">): Promise<CloudHubResult<"abort">> {
		return this.call("abort", args);
	}
	pendingPrompts(
		...args: CloudHubArgs<"pendingPrompts">
	): Promise<CloudHubResult<"pendingPrompts">> {
		return this.call("pendingPrompts", args);
	}
	updatePendingPrompt(
		...args: CloudHubArgs<"updatePendingPrompt">
	): Promise<CloudHubResult<"updatePendingPrompt">> {
		return this.call("updatePendingPrompt", args);
	}
	removePendingPrompt(
		...args: CloudHubArgs<"removePendingPrompt">
	): Promise<CloudHubResult<"removePendingPrompt">> {
		return this.call("removePendingPrompt", args);
	}
	readMessages(
		...args: CloudHubArgs<"readMessages">
	): Promise<CloudHubResult<"readMessages">> {
		return this.call("readMessages", args);
	}
	getArtifactDownloadUrl(
		...args: CloudHubArgs<"getArtifactDownloadUrl">
	): Promise<CloudHubResult<"getArtifactDownloadUrl">> {
		return this.call("getArtifactDownloadUrl", args);
	}
	updateTitle(
		...args: CloudHubArgs<"updateTitle">
	): Promise<CloudHubResult<"updateTitle">> {
		return this.call("updateTitle", args);
	}
	delete(...args: CloudHubArgs<"delete">): Promise<CloudHubResult<"delete">> {
		return this.call("delete", args);
	}
	listModels(scope?: CloudHubScope): Promise<CloudHubResult<"listModels">> {
		return this.call("listModels", [], scope);
	}
	listRepositories(
		...args: CloudHubArgs<"listRepositories">
	): Promise<CloudHubResult<"listRepositories">> {
		return this.call("listRepositories", args);
	}
	listBranches(
		...args: CloudHubArgs<"listBranches">
	): Promise<CloudHubResult<"listBranches">> {
		return this.call("listBranches", args);
	}
	respondApproval(
		...args: CloudHubArgs<"respondApproval">
	): Promise<CloudHubResult<"respondApproval">> {
		return this.call("respondApproval", args);
	}
	restoreCreationOptions(
		...args: CloudHubArgs<"restoreCreationOptions">
	): Promise<CloudHubResult<"restoreCreationOptions">> {
		return this.call("restoreCreationOptions", args);
	}
	getCrossScopeDiscoveryRecord(
		...args: CloudHubArgs<"getCrossScopeDiscoveryRecord">
	): Promise<CloudHubResult<"getCrossScopeDiscoveryRecord">> {
		return this.call("getCrossScopeDiscoveryRecord", args);
	}
	async list(): Promise<CloudSessionRecord[]> {
		const records = await this.call("list", []);
		return records;
	}
	async listForDiscovery(
		...args: CloudHubArgs<"listForDiscovery">
	): Promise<JsonRecord[]> {
		const records = await this.call("listForDiscovery", args);
		for (const record of records)
			this.records.set(String(record.sessionId), structuredClone(record));
		return records;
	}
	getCachedDiscoveryRecord(sessionId: string): JsonRecord | undefined {
		const record = this.records.get(sessionId);
		return record ? structuredClone(record) : undefined;
	}
	getSnapshot(sessionId: string): CloudSessionSnapshot | undefined {
		const snapshot = this.snapshots.get(sessionId);
		return snapshot ? structuredClone(snapshot) : undefined;
	}
	isCloudSession(sessionId: string): boolean {
		return (
			sessionId.trim().startsWith("ses-") ||
			this.records.has(sessionId) ||
			this.snapshots.has(sessionId)
		);
	}
	async dispose(): Promise<void> {
		this.disposed = true;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		for (const sessionId of this.snapshots.keys())
			for (const listener of this.listeners)
				listener({ type: "removed", sessionId });
		this.snapshots.clear();
		this.records.clear();
		this.listeners.clear();
	}
}
