import {
	type CloudCreationOptions,
	type CloudHubConnection,
	type CloudSessionEvent,
	type CreateCloudSessionInput,
	HubCloudSessionClient,
} from "@cline/core/cloud";
import {
	ensureSharedHubClient,
	getEnvironmentContext,
	getSidecarContextOwner,
	handleHubLiveEvent,
	sendEvent,
} from "./context";
import { readSessionMessagesSync } from "./session-data/messages";
import type { LiveSession, SidecarContext } from "./types";
import { LOCAL_ENVIRONMENT_ID } from "./types";

export * from "@cline/core/cloud";

/** Desktop projection adapter. Cloud transport and authoritative state live in core. */
export class CloudSessionManager extends HubCloudSessionClient {
	private readonly ownedIds = new Set<string>();
	private readonly approvalSnapshots = new Map<string, string>();
	private readonly ctx: SidecarContext;
	constructor(
		ctx: SidecarContext,
		connect?: () => Promise<CloudHubConnection>,
	) {
		const owner = getSidecarContextOwner(ctx);
		super(connect ?? (() => ensureSharedHubClient(owner)));
		this.ctx = getEnvironmentContext(owner, LOCAL_ENVIRONMENT_ID);
		this.subscribe((event) => this.project(event));
	}
	override async create(input: Omit<CreateCloudSessionInput, "handoff">) {
		return await super.create({
			...input,
			sandboxType: input.sandboxType ?? "resumable",
		});
	}
	override async listForDiscovery(
		options: { timeoutMs?: number } = {},
	): Promise<Record<string, unknown>[]> {
		return (await super.listForDiscovery(options)).map((record) => ({
			...record,
			environmentId: LOCAL_ENVIRONMENT_ID,
		}));
	}
	override getCachedDiscoveryRecord(
		sessionId: string,
	): Record<string, unknown> | undefined {
		const record = super.getCachedDiscoveryRecord(sessionId);
		return record
			? { ...record, environmentId: LOCAL_ENVIRONMENT_ID }
			: undefined;
	}
	override async getCrossScopeDiscoveryRecord(
		sessionId: string,
	): Promise<Record<string, unknown> | undefined> {
		const record = await super.getCrossScopeDiscoveryRecord(sessionId);
		return record
			? { ...record, environmentId: LOCAL_ENVIRONMENT_ID }
			: undefined;
	}

	private project(event: CloudSessionEvent): void {
		if (event.type === "prompt_accepted") return;
		const id = event.sessionId;
		if (event.type === "hub_event") {
			handleHubLiveEvent(this.ctx, event.event);
			return;
		}
		if (event.type === "sync_failed") {
			sendEvent(this.ctx, "cloud_session_sync_failed", {
				sessionId: id,
				message: event.message,
			});
			return;
		}
		if (event.type === "removed") {
			if (!this.ownedIds.delete(id)) return;
			this.ctx.liveSessions.delete(id);
			this.clearProjectedApprovals(id);
			if (this.approvalSnapshots.get(id) !== "[]")
				sendEvent(this.ctx, "tool_approval_state", {
					sessionId: id,
					items: [],
				});
			this.approvalSnapshots.delete(id);
			return;
		}
		this.ownedIds.add(id);
		const snapshot = event.snapshot;
		const previous = this.ctx.liveSessions.get(id);
		const state: LiveSession = {
			config: structuredClone(snapshot.config),
			messages: structuredClone(snapshot.messages),
			promptsInQueue: structuredClone(snapshot.promptsInQueue),
			busy: snapshot.busy,
			startedAt: snapshot.startedAt,
			endedAt: snapshot.endedAt,
			status: snapshot.status,
			prompt: snapshot.prompt,
			title: snapshot.title,
			attachedViaHub: true,
		};
		// Preserve object identity for existing desktop hosts; never share it with core.
		if (previous) Object.assign(previous, state);
		else this.ctx.liveSessions.set(id, state);
		const approvalsJson = JSON.stringify(snapshot.approvals);
		if (
			event.replace ||
			event.cause === "approvals" ||
			(this.approvalSnapshots.get(id) !== approvalsJson &&
				snapshot.approvals.length > 0)
		) {
			this.approvalSnapshots.set(id, approvalsJson);
			this.clearProjectedApprovals(id);
			for (const approval of snapshot.approvals)
				this.ctx.pendingApprovals.set(approval.requestId, {
					item: structuredClone(approval),
					resolve: (result) =>
						this.respondApproval(id, approval.approvalId, result),
				});
			sendEvent(this.ctx, "tool_approval_state", {
				sessionId: id,
				items: snapshot.approvals,
			});
		}
		if (event.cause === "queue" || event.replace)
			sendEvent(this.ctx, "prompts_in_queue_state", {
				sessionId: id,
				items: snapshot.promptsInQueue,
			});
		if (event.cause === "ended")
			sendEvent(this.ctx, "chat_session_ended", {
				sessionId: id,
				reason: snapshot.status === "failed" ? "error" : snapshot.status,
			});
		if (event.cause === "status")
			sendEvent(this.ctx, "chat_session_status", {
				sessionId: id,
				status: snapshot.status,
				...(snapshot.record?.metadata.provisioningPhase
					? { phase: snapshot.record.metadata.provisioningPhase }
					: {}),
			});
		if (event.replace)
			sendEvent(this.ctx, "cloud_session_rehydrated", {
				sessionId: id,
				status: snapshot.status,
				transcriptKnown: snapshot.transcriptKnown,
				messages: readSessionMessagesSync(this.ctx, id, 800, snapshot.messages),
			});
	}
	private clearProjectedApprovals(id: string): void {
		for (const [key, pending] of this.ctx.pendingApprovals)
			if (pending.item.sessionId === id) this.ctx.pendingApprovals.delete(key);
	}
	override async send(
		id: string,
		prompt: string,
		delivery?: "queue" | "steer",
		modelId?: string,
		images?: string[],
	) {
		// Existing desktop commands update this local preference before lazy inner creation.
		const config = this.ctx.liveSessions.get(id)?.config;
		if (config)
			await this.restoreCreationOptions(id, {
				...(typeof config.autoApproveTools === "boolean"
					? { autoApproveTools: config.autoApproveTools }
					: {}),
				...(typeof config.thinking === "boolean"
					? { thinking: config.thinking }
					: {}),
				...(typeof config.reasoningEffort === "string"
					? {
							reasoningEffort:
								config.reasoningEffort as CloudCreationOptions["reasoningEffort"],
						}
					: {}),
			});
		try {
			return await super.send(id, prompt, delivery, modelId, images);
		} finally {
			const snapshot = this.getSnapshot(id);
			if (snapshot)
				this.project({
					type: "snapshot",
					sessionId: id,
					snapshot,
					replace: false,
				});
		}
	}
}
export function getCloudSessionManager(
	ctx: SidecarContext,
): CloudSessionManager {
	ctx = getSidecarContextOwner(ctx);
	if (ctx.cloudSessionManager instanceof CloudSessionManager)
		return ctx.cloudSessionManager;
	const manager = new CloudSessionManager(ctx);
	ctx.cloudSessionManager = manager;
	return manager;
}

/** Release this desktop viewer; the hub retains cloud work and sandbox connections. */
export async function resetCloudSessionManager(
	ctx: SidecarContext,
): Promise<void> {
	ctx = getSidecarContextOwner(ctx);
	const manager = ctx.cloudSessionManager;
	ctx.cloudSessionManager = null;
	await manager?.dispose();
}
