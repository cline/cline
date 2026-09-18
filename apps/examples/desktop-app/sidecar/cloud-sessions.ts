import { ClineAccountService, ProviderSettingsManager } from "@cline/core";
import {
	type CloudCreationOptions,
	CloudSessionApi,
	CloudSessionController,
	type CloudSessionControllerOptions,
	type CloudSessionEvent,
} from "@cline/core/cloud";
import { getClineEnvironmentConfig } from "@cline/shared";
import { resolveFreshClineAuthToken } from "./cline-auth";
import { handleHubLiveEvent, sendEvent } from "./context";
import { readSessionMessagesSync } from "./session-data/messages";
import type { LiveSession, SidecarContext } from "./types";

export * from "@cline/core/cloud";

/** Desktop projection adapter. Cloud transport and authoritative state live in core. */
export class CloudSessionManager extends CloudSessionController {
	private readonly ownedIds = new Set<string>();
	private readonly approvalSnapshots = new Map<string, string>();
	constructor(
		private readonly ctx: SidecarContext,
		options: CloudSessionControllerOptions,
	) {
		super({
			...options,
			logger: options.logger ?? ctx.logger,
			lateCreateDisposition: options.lateCreateDisposition ?? "delete",
			clientIdentity: options.clientIdentity ?? {
				prefix: "code-cloud",
				type: "code-cloud-sidecar",
				displayName: "Cline Code cloud session",
				source: "desktop",
			},
		});
		for (const [id, state] of ctx.liveSessions)
			if (state.config.executionTarget === "cloud")
				this.seedSessionState(id, state);
		this.subscribe((event) => this.project(event));
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
		if (event.cause === "queue")
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
			this.restoreCreationOptions(id, {
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
	const existing = ctx.cloudSessionManager;
	if (existing instanceof CloudSessionManager) {
		return existing;
	}
	const environment = getClineEnvironmentConfig();
	const providerSettingsManager = new ProviderSettingsManager();
	const getAuthToken = () =>
		resolveFreshClineAuthToken(providerSettingsManager, ctx);
	const api = new CloudSessionApi({
		apiBaseUrl: environment.apiBaseUrl,
		appBaseUrl: environment.appBaseUrl,
		getAuthToken,
	});
	const accountService = new ClineAccountService({
		apiBaseUrl: environment.apiBaseUrl,
		getAuthToken,
	});
	// Cache successful org lookups across sidebar polls; never cache failures.
	let activeOrgCache: { id: string | undefined; at: number } | undefined;
	const getActiveOrganizationId = async (options?: {
		fresh?: boolean;
	}): Promise<string | undefined> => {
		if (
			!options?.fresh &&
			activeOrgCache &&
			Date.now() - activeOrgCache.at < 60_000
		) {
			return activeOrgCache.id;
		}
		if (!(await getAuthToken())?.trim()) {
			return undefined;
		}
		const organizations = await accountService.fetchUserOrganizations();
		const id = organizations?.find(
			(organization) => organization.active,
		)?.organizationId;
		activeOrgCache = { id, at: Date.now() };
		return id;
	};
	const manager = new CloudSessionManager(ctx, {
		api,
		apiBaseUrl: environment.apiBaseUrl,
		getAuthToken,
		getActiveOrganizationId,
	});
	ctx.cloudSessionManager = manager;
	return manager;
}

export async function resetCloudSessionManager(
	ctx: SidecarContext,
): Promise<void> {
	const manager = ctx.cloudSessionManager;
	ctx.cloudSessionManager = null;
	await manager?.dispose();
}
