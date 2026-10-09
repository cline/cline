// SdkCloudSessionCoordinator — starts, reopens and monitors Cline Cloud sessions.
//
// Cloud sessions run in a hosted sandbox and keep going after the user moves on,
// so this coordinator owns two things the local task flow does not need:
//
//   1. A registry of live sandbox connections (CloudSessionHost). A connection
//      is kept after the user leaves the task view so the agent's real status
//      (running / completed / failed) stays known for History and so a
//      background cloud task can raise a "finished" notification. REST alone
//      cannot tell a busy agent from an idle sandbox ("active" only means the
//      sandbox is up).
//   2. The projection of cloud records into task history (SessionHistoryRecord
//      shape) so History, the home screen and the running-now strip list cloud
//      tasks next to local ones.

import type { ITelemetryService, SessionAccumulatedUsage, SessionHistoryRecord, StartSessionInput } from "@cline/core"
import type { MessageWithMetadata as SdkMessage } from "@cline/llms"
import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared"
import {
	ACTIVE_CLOUD_STATUSES,
	CLOUD_PROVISIONING_ID_PREFIX,
	CLOUD_SESSION_MODE,
	CLOUD_WORKSPACE_ROOT,
	type CloudSessionStatus,
	type CurrentCloudTaskInfo,
	isCloudSessionId,
	isPersistedCloudSessionId,
	type RememberedCloudStatuses,
} from "@shared/cloud/cloud-sessions"
import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { ShowMessageType } from "@shared/proto/host/window"
import {
	getCachedClineRecommendedModels,
	refreshClineRecommendedModels,
} from "@/core/controller/models/refreshClineRecommendedModels"
import type { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import {
	type CloudProvisioningPhase,
	CloudSessionError,
	type CloudSessionRecord,
	type CloudSessionsService,
	isCloudSessionExpired,
} from "@/services/cloud/CloudSessionsService"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@/shared/cline/recommended-models"
import { Logger } from "@/shared/services/Logger"
import { PendingStartJournal, type PendingStartRecord } from "./cloud-pending-starts"
import { CloudSessionHost } from "./cloud-session-host"
import type { MessageIdMinter } from "./message-id-minter"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { sdkMessagesToDisplayClineMessages, sessionHistoryRecordToHistoryItem } from "./sdk-task-history"
import type { SdkSessionHost } from "./session-host"
import { createTaskProxy, type TaskProxy } from "./task-proxy"

const LIST_CACHE_TTL_MS = 10_000
const ACTIVE_POLL_INTERVAL_MS = 15_000
const IDLE_CONNECTION_TTL_MS = 5 * 60_000

/**
 * The control plane stamps a record's `updatedAt` when a client connects to
 * its sandbox, a moment after the socket has reported the agent status. A
 * touch this soon after an observation is attributed to the connection that
 * made the observation, not to activity elsewhere.
 */
const CONNECT_TOUCH_GRACE_MS = 60_000

/**
 * Whether a status is worth remembering across restarts. An active status is
 * re-learned live, because only rows still unknown are re-resolved on launch.
 */
function isSettled(status: CloudSessionStatus): boolean {
	return status !== "unknown" && !ACTIVE_CLOUD_STATUSES.has(status)
}

/** Idle time after which the control plane retires a standard sandbox. */
const CLOUD_SANDBOX_IDLE_HOURS = 24

/**
 * Explains an expired session in the user's terms. The sandbox is retired by
 * the control plane, not lost through anything the user did; whether a
 * transcript survived depends on whether a viewer disconnected from the live
 * sandbox before it was retired.
 */
function describeExpiredCloudSession(
	record: Pick<CloudSessionRecord, "repoContext">,
	archived: SdkMessage[] | undefined,
	archiveError: string | undefined,
): string {
	const repo = record.repoContext.repoUrl?.replace(/^https:\/\/github\.com\//, "")
	const where = repo ? ` on ${repo}${record.repoContext.branch ? ` (${record.repoContext.branch})` : ""}` : ""
	const retired = `This cloud sandbox was retired after ${CLOUD_SANDBOX_IDLE_HOURS} hours without activity.`
	const resume = `To keep working on this, start a new cloud task${where}.`
	if (archiveError) {
		return `${retired} Its saved conversation could not be loaded right now (${archiveError}). ${resume}`
	}
	if (!archived) {
		return `${retired} No conversation was saved for it: the sandbox was already gone when the last viewer disconnected. ${resume}`
	}
	return `${retired} The conversation above is saved here to read. ${resume}`
}
const USAGE_REFRESH_TIMEOUT_MS = 2_000
const STATUS_RESOLUTION_RETRY_MS = 30_000
const STATUS_RESOLUTION_CONCURRENCY = 4

function provisioningPhaseText(phase: CloudProvisioningPhase, sandboxLabel: string): string | undefined {
	switch (phase) {
		case "cloning_repo":
			return `Cloning ${sandboxLabel} into the cloud sandbox…`
		case "agent_starting":
			return "Starting the agent in the cloud sandbox…"
		default:
			return undefined
	}
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
	return new Promise((resolve, reject) => {
		const timeout = globalThis.setTimeout(() => resolve(undefined), timeoutMs)
		promise.then(
			(value) => {
				globalThis.clearTimeout(timeout)
				resolve(value)
			},
			(error) => {
				globalThis.clearTimeout(timeout)
				reject(error)
			},
		)
	})
}
const SCOPE_DRAIN_TIMEOUT_MS = 15_000
const ABANDONED_STARTS_RECHECK_MS = 10_000

export interface CloudTaskInput {
	prompt: string
	images?: string[]
	repoUrl: string
	branch?: string
}

const HISTORY_STATUS: Record<CloudSessionStatus, SessionHistoryRecord["status"]> = {
	provisioning: "pending",
	running: "running",
	idle: "idle",
	completed: "completed",
	failed: "failed",
	cancelled: "cancelled",
	unknown: "pending",
	expired: "cancelled",
}

export interface SdkCloudSessionCoordinatorOptions {
	cloudSessions: CloudSessionsService
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	sessionConfigBuilder: SdkSessionConfigBuilder
	messages: SdkMessageCoordinator
	getMinter: () => MessageIdMinter
	getTask: () => TaskProxy | undefined
	setTask: (task: TaskProxy | undefined) => void
	onAskResponse: (text?: string, images?: string[], files?: string[]) => Promise<void>
	onCancelTask: () => Promise<void>
	/**
	 * Ends the current task view (local or cloud) before a cloud task is
	 * installed, and returns the fence of the task-view claim it made.
	 */
	clearTask: () => Promise<() => boolean>
	/**
	 * A cloud start failed before it had a session and `task` now shows the
	 * error. The controller keeps `input` so the footer's Retry runs it again.
	 */
	onStartFailed: (task: TaskProxy, input: CloudTaskInput) => void
	claimTaskViewGeneration: () => () => boolean
	requestToolApproval: (request: ToolApprovalRequest) => Promise<ToolApprovalResult>
	getAuthToken: () => Promise<string | null | undefined>
	isSignedIn: () => boolean
	isEnabled: () => boolean
	resetMessageTranslator: () => void
	setTurnPhase: (phase: TurnPhase, anchorTs?: number) => void
	/** Forgets the previous turn's completion signal so a new cloud turn's phase is computed fresh. */
	clearTurnOutcome: () => void
	postStateToWebview: () => Promise<void>
	invalidateHistoryCache: () => void
	resolveContextMentions: (text: string) => Promise<string>
	telemetry?: ITelemetryService
	/**
	 * Where this extension host records sandboxes it is still starting (one file
	 * per host, so concurrent windows never overwrite each other's records), so
	 * a later host can delete them if this one exits first. Off when unset.
	 */
	pendingStartsDir?: string
	/** Identity of the active account (user and organization), so recovery acts only for the account that started a sandbox. */
	getAccountScope?: () => string | undefined
}

interface CloudSessionEntry {
	record: CloudSessionRecord
	/** Live connection, when this extension instance is attached to the sandbox. */
	host?: CloudSessionHost
	connection?: Promise<CloudSessionHost>
	/**
	 * Number of openCloudTask calls currently reading from or attaching to the
	 * host. Status resolution and the idle sweep leave a pinned host open.
	 */
	pinned: number
	/**
	 * Last agent status observed over a live connection, kept after the
	 * connection is dropped and remembered across restarts while the control
	 * plane record has not changed since (see rememberedStatusOf).
	 */
	agentStatus?: CloudSessionStatus
	/** Usage snapshot from this entry's live host. REST-only records do not expose usage. */
	usage?: SessionAccumulatedUsage
	title?: string
	lastActivityAt: number
}

export class SdkCloudSessionCoordinator {
	private readonly entries = new Map<string, CloudSessionEntry>()
	private listFetchedAt = 0
	private listPromise: Promise<void> | undefined
	private pollTimer: NodeJS.Timeout | undefined
	private disposed = false
	private scopeGeneration = 0
	private startGeneration = 0
	/** Set while a cloud start is provisioning; aborted by cancelPendingStart. */
	private pendingStart: AbortController | undefined
	/** The sandbox the pending start created, once the control plane has named it. */
	private pendingStartSessionId: string | undefined
	/** The task view the pending start installed, once it has one. */
	private pendingStartTask: TaskProxy | undefined
	/**
	 * Re-claims the task view for the pending start when the user returns to it,
	 * so a selection made in between is rejected. False once the start has seen
	 * that it lost the view and is cleaning up.
	 */
	private renewPendingStartView: (() => boolean) | undefined
	/** The one recommendation fetch started for the composer label; see warmRecommendedModels. */
	private recommendedModelsWarmup: Promise<unknown> | undefined
	private scopeTransition: Promise<void> | undefined
	private readonly scopeOperations = new Set<Promise<unknown>>()
	private readonly statusResolutionAttempts = new Map<string, number>()
	private readonly journal: PendingStartJournal | undefined
	private abandonedStartsRecovery: Promise<void> | undefined
	private abandonedStartsRecheck: ReturnType<typeof setTimeout> | undefined

	constructor(private readonly options: SdkCloudSessionCoordinatorOptions) {
		this.journal = options.pendingStartsDir ? new PendingStartJournal(options.pendingStartsDir) : undefined
	}

	isCloudSessionId(id: string): boolean {
		return isCloudSessionId(id)
	}

	isAvailable(): boolean {
		return this.options.isEnabled() && this.options.isSignedIn()
	}

	// ---- Status / state projection ----

	statusOf(entry: CloudSessionEntry): CloudSessionStatus {
		if (isCloudSessionExpired(entry.record)) {
			return "expired"
		}
		const rest = entry.record.status?.toLowerCase()
		if (rest === "provisioning" || rest === "pending") {
			return "provisioning"
		}
		if (rest === "failed") {
			return "failed"
		}
		if (rest === "suspended") {
			// A suspended sandbox runs nothing, so there is nothing to resolve over a
			// socket (it would be refused). Keep the last outcome seen here, even
			// though the control plane keeps touching updatedAt while it sleeps.
			const known = entry.agentStatus ?? this.rememberedStatuses()[entry.record.id]?.status
			return known && isSettled(known) ? known : "idle"
		}
		return entry.agentStatus ?? "unknown"
	}

	/**
	 * The status remembered for a record from a previous connection, if the
	 * control plane has not updated the record since it was observed. A later
	 * `updatedAt` means another client connected while nothing here watched,
	 * so the agent may have run again.
	 */
	private rememberedStatusOf(record: CloudSessionRecord): CloudSessionStatus | undefined {
		const remembered = this.rememberedStatuses()[record.id]
		if (!remembered) {
			return undefined
		}
		const updatedAt = Date.parse(record.updatedAt)
		return Number.isFinite(updatedAt) && updatedAt <= remembered.observedAt + CONNECT_TOUCH_GRACE_MS
			? remembered.status
			: undefined
	}

	/** Global state does not apply declared defaults on read; an install that never remembered anything has no key. */
	private rememberedStatuses(): RememberedCloudStatuses {
		return this.options.stateManager.getGlobalStateKey("cloudSessionStatuses") ?? {}
	}

	private rememberStatus(record: CloudSessionRecord, status: CloudSessionStatus, observedAt: number): void {
		this.options.stateManager.setGlobalState("cloudSessionStatuses", {
			...this.rememberedStatuses(),
			[record.id]: { status, observedAt },
		})
	}

	private rememberPendingStart(sessionId: string): void {
		this.journal?.add({
			sessionId,
			account: this.options.getAccountScope?.(),
			endpoint: this.options.cloudSessions.apiBaseUrl,
		})
	}

	/** After a confirmed deletion; a record left behind only makes a later host see a 404. */
	private forgetPendingStart(sessionId: string): void {
		try {
			this.journal?.remove(sessionId)
		} catch (error) {
			Logger.warn("[CloudSessions] Failed to update pending cloud starts:", error)
		}
	}

	/**
	 * Settles sandboxes left by starts that a reload, quit or crash interrupted,
	 * as one scope operation of the account that started them: an account change
	 * waits for a DELETE in flight and stops the rest, and nothing runs after
	 * disposal. Records of another account or endpoint wait for that scope.
	 */
	private recoverAbandonedStarts(): Promise<void> {
		if (!this.journal || this.disposed || this.scopeTransition) return Promise.resolve()
		this.abandonedStartsRecovery ??= this.trackScopeOperation(() => this.recoverAbandonedStartsInScope()).finally(() => {
			this.abandonedStartsRecovery = undefined
		})
		return this.abandonedStartsRecovery
	}

	private async recoverAbandonedStartsInScope(): Promise<void> {
		const generation = this.scopeGeneration
		const isCurrent = () => !this.disposed && generation === this.scopeGeneration
		if (!this.journal || !isCurrent()) return
		const { journals, liveOwners } = this.journal.abandoned()
		// After a reload the old extension host can still be exiting; look again shortly.
		if (liveOwners) this.scheduleAbandonedStartsRecheck()
		const account = this.options.getAccountScope?.()
		const endpoint = this.options.cloudSessions.apiBaseUrl
		let deleted = false
		for (const journal of journals) {
			const unresolved: PendingStartRecord[] = []
			for (const pending of journal.records) {
				if (pending.account !== account || pending.endpoint !== endpoint || !isCurrent()) {
					unresolved.push(pending)
					continue
				}
				// A record is dropped before the first prompt is sent, so its sandbox holds no user work.
				// Only a confirmed deletion settles it; anything else is retried later.
				try {
					await this.options.cloudSessions.deleteSession(pending.sessionId)
					deleted = true
				} catch (error) {
					if (!(error instanceof CloudSessionError && error.code === "session_not_found")) {
						Logger.warn(`[CloudSessions] Failed to delete abandoned cloud session ${pending.sessionId}:`, error)
						unresolved.push(pending)
					}
				}
			}
			journal.settle(unresolved)
		}
		if (deleted && isCurrent()) {
			this.listFetchedAt = 0
			this.options.invalidateHistoryCache()
			void this.options.postStateToWebview().catch(() => {})
		}
	}

	private scheduleAbandonedStartsRecheck(): void {
		if (this.abandonedStartsRecheck) return
		this.abandonedStartsRecheck = setTimeout(() => {
			this.abandonedStartsRecheck = undefined
			void this.recoverAbandonedStarts()
		}, ABANDONED_STARTS_RECHECK_MS)
		this.abandonedStartsRecheck.unref?.()
	}

	private cancelAbandonedStartsRecheck(): void {
		clearTimeout(this.abandonedStartsRecheck)
		this.abandonedStartsRecheck = undefined
	}

	/** Drops remembered statuses for sessions the account's list no longer contains. */
	private pruneRememberedStatuses(liveIds: ReadonlySet<string>): void {
		const statuses = this.rememberedStatuses()
		const kept = Object.fromEntries(Object.entries(statuses).filter(([id]) => liveIds.has(id)))
		if (Object.keys(kept).length !== Object.keys(statuses).length) {
			this.options.stateManager.setGlobalState("cloudSessionStatuses", kept)
		}
	}

	getCurrentTaskInfo(): CurrentCloudTaskInfo | undefined {
		const taskId = this.options.getTask()?.taskId
		if (!taskId || !isCloudSessionId(taskId)) {
			return undefined
		}
		const entry = this.entries.get(taskId)
		return {
			sessionId: taskId,
			repoUrl: entry?.record.repoContext.repoUrl,
			branch: entry?.record.repoContext.branch,
			// While the start is pending there is no session to send to yet; the
			// composer disables submit on this status instead of queueing.
			status: this.pendingStart ? "provisioning" : entry ? this.statusOf(entry) : "unknown",
		}
	}

	private toHistoryRecord(entry: CloudSessionEntry): SessionHistoryRecord {
		const { record } = entry
		const status = this.statusOf(entry)
		// The control plane's title wins so renames from the dashboard show up; the
		// local one covers the moment before this window's own rename lands.
		const title = record.title?.trim() || entry.title || ""
		return {
			sessionId: record.id,
			source: "vscode",
			pid: 0,
			startedAt: record.createdAt,
			endedAt: status === "expired" ? (record.expiredAt ?? undefined) : undefined,
			exitCode: status === "completed" ? 0 : undefined,
			status: HISTORY_STATUS[status],
			interactive: true,
			provider: "cline",
			model: record.metadata.modelId ?? "",
			cwd: CLOUD_WORKSPACE_ROOT,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
			prompt: title,
			metadata: {
				title: title || `Cloud session on ${record.repoContext.repoUrl ?? "GitHub"}`,
				executionTarget: "cloud",
				cloudStatus: status,
				repoUrl: record.repoContext.repoUrl ?? "",
				branch: record.repoContext.branch ?? "",
				modelId: record.metadata.modelId ?? "",
				...(entry.usage
					? {
							usageAvailable: true,
							tokensIn: entry.usage.inputTokens,
							tokensOut: entry.usage.outputTokens,
							cacheReads: entry.usage.cacheReadTokens,
							cacheWrites: entry.usage.cacheWriteTokens,
							totalCost: entry.usage.totalCost,
						}
					: {}),
				git: { url: record.repoContext.repoUrl, branch: record.repoContext.branch },
			},
			// Keep a task the user is actively working on at the top of History.
			updatedAt: new Date(Math.max(Date.parse(record.updatedAt) || 0, entry.lastActivityAt)).toISOString(),
		}
	}

	/** History rows for every cloud session in the active account scope (cached briefly). */
	async listHistoryRecords(): Promise<SessionHistoryRecord[]> {
		if (!this.isAvailable() || this.scopeTransition) {
			return []
		}
		await this.refreshList()
		if (this.scopeTransition) return []
		const generation = this.scopeGeneration
		// The pending start's own task row already stands for its sandbox.
		const pendingStartSessionId = this.pendingStartSessionId
		const entries = [...this.entries.values()].filter((entry) => entry.record.id !== pendingStartSessionId)
		await this.refreshUsage(entries)
		// A start that settled meanwhile has invalidated History; omitting its row now would be cached as current.
		if (generation !== this.scopeGeneration || pendingStartSessionId !== this.pendingStartSessionId) {
			return this.listHistoryRecords()
		}
		return entries.map((entry) => this.toHistoryRecord(entry))
	}

	async findHistoryRecord(sessionId: string): Promise<SessionHistoryRecord | undefined> {
		if (!this.isAvailable() || this.scopeTransition) {
			return undefined
		}
		let entry = this.entries.get(sessionId)
		if (!entry) {
			await this.refreshList(true)
			entry = this.entries.get(sessionId)
		}
		if (!entry) {
			return undefined
		}
		const generation = this.scopeGeneration
		await this.refreshUsage([entry])
		if (generation !== this.scopeGeneration || this.entries.get(sessionId) !== entry) {
			return this.findHistoryRecord(sessionId)
		}
		return this.toHistoryRecord(entry)
	}

	/** Resolves live status only for cloud rows a caller is about to display. */
	async resolveStatuses(sessionIds: Iterable<string>): Promise<Array<{ sessionId: string; status: CloudSessionStatus }>> {
		await this.scopeTransition
		const generation = this.scopeGeneration
		const now = Date.now()
		const visibleIds = [...new Set(sessionIds)].filter(isPersistedCloudSessionId).slice(0, 100)
		let changed = false
		const pendingIds = [...visibleIds]
		const resolveNext = async (): Promise<void> => {
			for (let sessionId = pendingIds.shift(); sessionId; sessionId = pendingIds.shift()) {
				const entry = this.entries.get(sessionId)
				if (!entry || this.statusOf(entry) !== "unknown") continue
				try {
					if (entry.connection) {
						await entry.connection
						changed = true
						continue
					}
					const lastAttempt = this.statusResolutionAttempts.get(sessionId)
					if (lastAttempt !== undefined && now - lastAttempt < STATUS_RESOLUTION_RETRY_MS) continue
					this.statusResolutionAttempts.set(sessionId, now)
					const host = await this.connect(entry)
					this.statusResolutionAttempts.delete(sessionId)
					changed = true
					if (!ACTIVE_CLOUD_STATUSES.has(this.statusOf(entry)) && !this.isHostInUse(entry)) {
						await host.dispose("statusResolved").catch(() => undefined)
						if (entry.host === host) entry.host = undefined
					}
				} catch (error) {
					Logger.warn(`[CloudSessions] Failed to resolve status for ${sessionId}:`, error)
				}
			}
		}
		await Promise.allSettled(
			Array.from({ length: Math.min(STATUS_RESOLUTION_CONCURRENCY, pendingIds.length) }, () => resolveNext()),
		)
		if (changed && !this.disposed && generation === this.scopeGeneration) {
			this.options.invalidateHistoryCache()
			void this.options.postStateToWebview().catch(() => undefined)
		}
		if (this.disposed || generation !== this.scopeGeneration) return []
		return visibleIds.flatMap((sessionId) => {
			const entry = this.entries.get(sessionId)
			return entry ? [{ sessionId, status: this.statusOf(entry) }] : []
		})
	}

	/** Whether the displayed task or an openCloudTask in progress relies on this entry's host. */
	private isHostInUse(entry: CloudSessionEntry): boolean {
		return entry.pinned > 0 || this.options.getTask()?.taskId === entry.record.id
	}

	private async refreshUsage(entries: CloudSessionEntry[]): Promise<void> {
		await Promise.all(
			entries.map(async (entry) => {
				const host = entry.host
				if (!host) {
					return
				}
				try {
					const usage = await withTimeout(host.getAccumulatedUsage(entry.record.id), USAGE_REFRESH_TIMEOUT_MS)
					if (usage && !this.disposed && this.entries.get(entry.record.id) === entry && entry.host === host) {
						entry.usage = usage
					}
				} catch (error) {
					Logger.warn(`[CloudSessions] Failed to read usage for ${entry.record.id}:`, error)
				}
			}),
		)
	}

	private async refreshList(force = false): Promise<void> {
		// The account mutation inside a scope transition posts state, which lists
		// History and lands here. Waiting for the transition would deadlock it, and
		// fetching would attribute old-account rows to the new scope. History
		// omits cloud rows during the transition; reset refreshes them afterwards.
		if (this.scopeTransition || this.disposed) return
		if (!force && Date.now() - this.listFetchedAt < LIST_CACHE_TTL_MS) {
			return
		}
		if (this.listPromise) {
			return this.listPromise
		}
		const generation = this.scopeGeneration
		let listPromise!: Promise<void>
		listPromise = (async () => {
			try {
				void this.recoverAbandonedStarts()
				const records = await this.options.cloudSessions.listSessions()
				if (generation !== this.scopeGeneration || this.disposed) {
					return
				}
				const seen = new Set<string>()
				for (const record of records) {
					seen.add(record.id)
					this.upsertRecord(record)
				}
				// A record that left the account's list was deleted elsewhere (for
				// example from the dashboard). Close its connection rather than keep
				// it in History; the task on screen keeps its host so that opening it
				// can explain the deletion (see explainConnectFailure).
				for (const [id, entry] of this.entries) {
					if (seen.has(id) || this.isHostInUse(entry)) continue
					this.entries.delete(id)
					this.statusResolutionAttempts.delete(id)
					void entry.host?.dispose("deleted").catch(() => undefined)
				}
				this.pruneRememberedStatuses(seen)
				this.listFetchedAt = Date.now()
			} catch (error) {
				// Reset invalidates both successful responses and failed requests.
				if (generation !== this.scopeGeneration || this.disposed) return
				if (error instanceof CloudSessionError && error.code === "authentication_required") {
					// The account's credentials no longer work. Drop the rows and close
					// the retained connections that nothing is using. The displayed task
					// keeps its entry and host: closing them would leave a task on screen
					// that cannot continue even after the user signs in again, and its
					// next interaction reports the authentication failure itself.
					for (const [id, entry] of this.entries) {
						if (this.isHostInUse(entry)) continue
						this.entries.delete(id)
						this.statusResolutionAttempts.delete(id)
						void entry.host?.dispose("authenticationRequired").catch(() => undefined)
					}
				}
				// Keep the last snapshot; History still renders local tasks.
				Logger.warn("[CloudSessions] Failed to refresh cloud session list:", error)
				this.listFetchedAt = Date.now()
			} finally {
				if (this.listPromise === listPromise) {
					this.listPromise = undefined
				}
			}
		})()
		this.listPromise = listPromise
		return listPromise
	}

	private upsertRecord(record: CloudSessionRecord): CloudSessionEntry {
		const existing = this.entries.get(record.id)
		if (existing) {
			existing.record = record
			// A retained host is not proof of continuous observation. Revalidate
			// settled outcomes against the record just as we do after restart.
			if (existing.agentStatus && isSettled(existing.agentStatus)) {
				existing.agentStatus = this.rememberedStatusOf(record)
			}
			return existing
		}
		const entry: CloudSessionEntry = {
			record,
			pinned: 0,
			agentStatus: this.rememberedStatusOf(record),
			lastActivityAt: Date.parse(record.updatedAt) || Date.now(),
		}
		this.entries.set(record.id, entry)
		return entry
	}

	/** Changes account scope as one boundary: invalidate, detach, dispose, mutate scope, then reopen reads. */
	async reset(changeScope?: () => Promise<void>): Promise<void> {
		this.scopeGeneration++
		this.statusResolutionAttempts.clear()
		this.cancelAbandonedStartsRecheck()
		const previousTransition = this.scopeTransition
		const transition = (async () => {
			await previousTransition
			this.listFetchedAt = 0
			this.listPromise = undefined
			if (this.pollTimer) {
				clearInterval(this.pollTimer)
				this.pollTimer = undefined
			}
			if (this.options.getTask()?.taskId && isCloudSessionId(this.options.getTask()?.taskId)) {
				await this.options.clearTask()
			}
			const entries = [...this.entries.values()]
			const hosts = entries.flatMap((entry) => (entry.host ? [entry.host] : []))
			const connections = entries.flatMap((entry) => (entry.connection ? [entry.connection] : []))
			this.entries.clear()
			this.options.invalidateHistoryCache()
			// Starts and deletions own their cleanup until settlement. Keep the originating
			// account active through every await, including DELETE; never retain old tokens.
			void this.trackScopeOperation(() =>
				Promise.allSettled([...connections, ...hosts.map((host) => host.dispose("accountScopeChanged"))]),
			)
			await this.drainScopeOperations([...this.scopeOperations])
			await changeScope?.()
		})()
		this.scopeTransition = transition
		try {
			await transition
		} finally {
			if (this.scopeTransition === transition) {
				this.scopeTransition = undefined
				// Refresh even after failure: the server may have switched accounts
				// before a later auth/config refresh failed.
				if (!this.disposed) {
					this.options.invalidateHistoryCache()
					void this.options.postStateToWebview().catch(() => {})
				}
			}
		}
	}

	private trackScopeOperation<T>(operation: () => Promise<T>): Promise<T> {
		// Enroll before executing any code that can yield or re-enter reset.
		const promise = Promise.resolve().then(operation)
		this.scopeOperations.add(promise)
		return promise.finally(() => this.scopeOperations.delete(promise))
	}

	private async drainScopeOperations(operations: Promise<unknown>[]): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined
		try {
			await Promise.race([
				Promise.allSettled(operations),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(
						() =>
							reject(
								new Error(
									"Cloud session cleanup is still pending. Your account has not changed; try again after cleanup finishes.",
								),
							),
						SCOPE_DRAIN_TIMEOUT_MS,
					)
				}),
			])
		} finally {
			clearTimeout(timer)
		}
	}

	// ---- Connections ----

	private async connect(entry: CloudSessionEntry): Promise<CloudSessionHost> {
		if (entry.connection) {
			return entry.connection
		}
		if (entry.host && this.statusOf(entry) !== "unknown") return entry.host
		const sessionId = entry.record.id
		const taskId = entry.record.metadata.taskId?.trim()
		if (!taskId) {
			throw new Error(`Cloud session ${sessionId} has no canonical task id.`)
		}
		const generation = this.scopeGeneration
		const record = entry.record
		const connection = (async () => {
			const retainedHost = entry.host
			const host =
				retainedHost ??
				(await CloudSessionHost.connect({
					outerSessionId: sessionId,
					taskId,
					sandboxType: record.sandboxType ?? record.metadata.sandboxType,
					socketUrl: this.options.cloudSessions.sessionSocketUrl(sessionId),
					getAuthToken: this.options.getAuthToken,
					requestToolApproval: this.options.requestToolApproval,
					telemetry: this.options.telemetry,
					restoreConfig: () => this.cloudSessionConfig(record.metadata.modelId ?? this.nextCloudModelId()),
					onStatusChange: (status) => {
						// A replaced account entry must never receive its predecessor's events.
						if (!this.disposed && generation === this.scopeGeneration && this.entries.get(sessionId) === entry) {
							this.handleStatusChange(sessionId, status)
						}
					},
				}))
			const status = retainedHost ? await retainedHost.refreshStatus() : host.status
			if (this.disposed || generation !== this.scopeGeneration || this.entries.get(sessionId) !== entry) {
				await host.dispose("accountScopeChanged").catch(() => undefined)
				throw new Error("Cloud session connection was superseded")
			}
			entry.host = host
			// A later list may invalidate the snapshot while the RPC is pending.
			if (entry.record === record) {
				entry.agentStatus = status
				if (isSettled(status)) this.rememberStatus(record, status, Date.now())
			}
			this.ensurePolling()
			return host
		})()
		entry.connection = connection
		try {
			return await connection
		} finally {
			if (entry.connection === connection) entry.connection = undefined
		}
	}

	private handleStatusChange(sessionId: string, status: CloudSessionStatus): void {
		const entry = this.entries.get(sessionId)
		if (!entry) {
			return
		}
		const previous = entry.agentStatus
		const now = Date.now()
		entry.agentStatus = status
		if (isSettled(status)) {
			this.rememberStatus(entry.record, status, now)
		}
		// Learning the current status on connect is not agent activity; only a
		// change observed while connected moves the task up in History.
		if (previous !== undefined && previous !== status) {
			entry.lastActivityAt = now
		}
		this.options.invalidateHistoryCache()
		const isDisplayed = this.options.getTask()?.taskId === sessionId
		if (!isDisplayed && previous !== undefined && previous !== status && (status === "completed" || status === "failed")) {
			this.notifyFinished(entry, status)
		}
		this.options.postStateToWebview().catch(() => {})
	}

	private notifyFinished(entry: CloudSessionEntry, status: CloudSessionStatus): void {
		const title = entry.record.title?.trim() || entry.title || entry.record.repoContext.repoUrl || entry.record.id
		const label = status === "failed" ? "Cloud task failed" : "Cloud task finished"
		HostProvider.window
			.showMessage({
				type: status === "failed" ? ShowMessageType.WARNING : ShowMessageType.INFORMATION,
				message: `${label}: ${title}`,
				options: { items: ["Open"] },
			})
			.then((response) => {
				if (!this.disposed && this.entries.get(entry.record.id) === entry && response.selectedOption === "Open") {
					return this.openCloudTask(entry.record.id)
				}
				return undefined
			})
			.catch((error) => Logger.warn("[CloudSessions] Failed to show completion notification:", error))
	}

	private ensurePolling(): void {
		if (this.pollTimer || this.disposed) {
			return
		}
		this.pollTimer = setInterval(() => void this.pollTick(), ACTIVE_POLL_INTERVAL_MS)
		this.pollTimer.unref?.()
	}

	private async pollTick(): Promise<void> {
		if (this.disposed) {
			return
		}
		const now = Date.now()
		for (const entry of this.entries.values()) {
			const status = this.statusOf(entry)
			if (
				entry.host &&
				!this.isHostInUse(entry) &&
				!ACTIVE_CLOUD_STATUSES.has(status) &&
				// Loss of observation is not evidence that the sandbox stopped.
				status !== "unknown" &&
				now - entry.lastActivityAt > IDLE_CONNECTION_TTL_MS
			) {
				// Finished a while ago and nobody is looking: release the socket.
				await entry.host.dispose("idle").catch(() => undefined)
				entry.host = undefined
			}
		}
		const hasActive = [...this.entries.values()].some((entry) => ACTIVE_CLOUD_STATUSES.has(this.statusOf(entry)))
		if (hasActive || this.entries.size > 0) {
			await this.refreshList(true)
			this.options.invalidateHistoryCache()
			this.options.postStateToWebview().catch(() => {})
		}
		if (![...this.entries.values()].some((entry) => entry.host)) {
			clearInterval(this.pollTimer)
			this.pollTimer = undefined
		}
	}

	// ---- Starting a task ----

	/**
	 * The Cline model a new sandbox runs: the user's Act-mode Cline model,
	 * else the top recommendation known so far. Synchronous, and the only
	 * source for both the composer label and the start path, so the sandbox
	 * runs the model the user saw when they submitted.
	 */
	private nextCloudModelId(): string {
		const apiConfig = this.options.stateManager.getApiConfiguration()
		if (apiConfig.actModeApiProvider === "cline" && apiConfig.actModeClineModelId?.trim()) {
			return apiConfig.actModeClineModelId.trim()
		}
		this.warmRecommendedModels()
		const recommended = getCachedClineRecommendedModels() ?? CLINE_RECOMMENDED_MODELS_FALLBACK
		return recommended.recommended[0]?.id ?? CLINE_RECOMMENDED_MODELS_FALLBACK.recommended[0].id
	}

	/**
	 * Fetches the recommendation list so the composer label moves from the
	 * built-in fallback to the live recommendation before the user submits.
	 * State is re-posted only when the list lands, because that post reads
	 * the model again and would otherwise start the next fetch. A fetch that
	 * leaves the cache empty just releases the handle, so the next state post
	 * the user causes retries instead of pinning the fallback until restart.
	 */
	private warmRecommendedModels(): void {
		if (this.recommendedModelsWarmup || getCachedClineRecommendedModels()) {
			return
		}
		const warmup = refreshClineRecommendedModels()
			.then(() => {
				if (!this.disposed && getCachedClineRecommendedModels()) {
					this.options.postStateToWebview().catch(() => {})
				}
			})
			.catch(() => undefined)
			.finally(() => {
				if (this.recommendedModelsWarmup === warmup) {
					this.recommendedModelsWarmup = undefined
				}
			})
		this.recommendedModelsWarmup = warmup
	}

	/** The model the displayed cloud task runs on, else the one a new cloud task would use. */
	getCloudModelId(): string {
		const taskId = this.options.getTask()?.taskId
		const entry = taskId ? this.entries.get(taskId) : undefined
		return entry?.host?.sessionModelId ?? entry?.record.metadata.modelId ?? this.nextCloudModelId()
	}

	/**
	 * Claims the next cloud start synchronously and returns the function that
	 * runs it. Callers that must await other work first (remote config) claim
	 * before awaiting, so a Cancel arriving in that gap invalidates this start.
	 */
	beginCloudTask(input: CloudTaskInput): () => Promise<string | undefined> {
		const generationBeforeTransition = this.scopeGeneration
		const startGeneration = ++this.startGeneration
		const pendingStart = new AbortController()
		this.pendingStart = pendingStart
		this.pendingStartTask = undefined
		this.renewPendingStartView = undefined
		// Snapshot the model now, before any await: it is what the composer was
		// showing when the user submitted.
		const modelId = this.nextCloudModelId()
		return async () => {
			try {
				await this.scopeTransition
				if (
					this.disposed ||
					generationBeforeTransition !== this.scopeGeneration ||
					startGeneration !== this.startGeneration
				)
					return undefined
				return await this.trackScopeOperation(() =>
					this.startCloudTaskInScope(input, modelId, generationBeforeTransition, startGeneration, pendingStart.signal),
				)
			} finally {
				if (this.pendingStart === pendingStart) {
					this.pendingStart = undefined
					this.pendingStartSessionId = undefined
					this.pendingStartTask = undefined
					this.renewPendingStartView = undefined
					// History omitted this start's record while it was pending.
					this.options.invalidateHistoryCache()
					// The failure path posts state while the start is still pending;
					// re-post so the composer no longer sees "provisioning".
					this.options.postStateToWebview().catch(() => {})
				}
			}
		}
	}

	/**
	 * Invalidates cloud provisioning before an active SDK session exists and
	 * stops the readiness poll, so the sandbox record is deleted as soon as the
	 * control plane answers instead of after the sandbox finishes starting.
	 */
	cancelPendingStart(): boolean {
		const pendingStart = this.pendingStart
		if (!pendingStart) {
			return false
		}
		this.pendingStart = undefined
		this.pendingStartSessionId = undefined
		this.pendingStartTask = undefined
		this.renewPendingStartView = undefined
		this.startGeneration++
		pendingStart.abort(new Error("Cloud task cancelled while provisioning"))
		return true
	}

	/**
	 * Cancels the pending start when `displayedTask` is its view, or when no task
	 * is shown yet because the start has not installed one. A Cancel on any other
	 * task belongs to that task, even while a start the user left is still settling.
	 */
	cancelPendingStartFor(displayedTask: TaskProxy | undefined): boolean {
		if (displayedTask && displayedTask !== this.pendingStartTask) return false
		return this.cancelPendingStart()
	}

	/** The sandbox session config a start uses, and that a resumed sandbox rebuilds its conversation with. */
	private async cloudSessionConfig(modelId: string): Promise<StartSessionInput["config"]> {
		const {
			apiKey: _apiKey,
			knownModels: _knownModels,
			providerConfig,
			...config
		} = await this.options.sessionConfigBuilder.build({
			cwd: CLOUD_WORKSPACE_ROOT,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			mode: CLOUD_SESSION_MODE,
			runtime: {
				modelSelection: { providerId: "cline", modelId },
				platform: "linux",
			},
		})
		return {
			...config,
			// The sandbox bills inference server-side, so the user's account token
			// (the Cline provider key) must never be shipped into it. It resolves
			// Cline models itself, so the local catalog (~150 KB) stays home too.
			...(providerConfig ? { providerConfig: { ...providerConfig, apiKey: undefined, knownModels: undefined } } : {}),
			cwd: CLOUD_WORKSPACE_ROOT,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			mode: CLOUD_SESSION_MODE,
			enableTools: true,
			checkpoint: { enabled: false },
			enableSpawnAgent: false,
			enableAgentTeams: false,
		}
	}

	private async startCloudTaskInScope(
		input: CloudTaskInput,
		modelId: string,
		generation: number,
		startGeneration: number,
		cancelSignal: AbortSignal,
	): Promise<string | undefined> {
		if (this.disposed || generation !== this.scopeGeneration || startGeneration !== this.startGeneration) return undefined
		// Keep the claim clearTask made: claiming again after the await would
		// override a selection the user made while the view was clearing.
		let isSuperseded = await this.options.clearTask()
		if (this.disposed || isSuperseded() || generation !== this.scopeGeneration || startGeneration !== this.startGeneration)
			return undefined
		let abandoned = false
		const isStale = () => {
			abandoned ||=
				this.disposed || isSuperseded() || generation !== this.scopeGeneration || startGeneration !== this.startGeneration
			return abandoned
		}
		const startedAt = Date.now()
		const provisionalId = `${CLOUD_PROVISIONING_ID_PREFIX}${startedAt}`
		const task = this.installTask(provisionalId)
		this.pendingStartTask = task
		this.renewPendingStartView = () => {
			if (abandoned) return false
			isSuperseded = this.options.claimTaskViewGeneration()
			return true
		}
		const title = input.prompt.trim().split("\n")[0]?.trim().slice(0, 120) || input.prompt.trim()
		const repoLabel = input.repoUrl.replace(/^https:\/\/github\.com\//, "")
		const sandboxLabel = `${repoLabel}${input.branch ? ` (${input.branch})` : ""}`
		const provisioningRow = (text: string): ClineMessage => ({
			ts: startedAt + 1,
			type: "say",
			say: "text",
			text,
			partial: false,
		})
		const provisioningEvent = { type: "status", payload: { sessionId: provisionalId, status: "running" } } as const

		this.options.messages.appendAndEmit(
			[
				{
					ts: startedAt,
					type: "say",
					say: "task",
					text: input.prompt,
					...(input.images?.length ? { images: input.images } : {}),
					partial: false,
				},
				provisioningRow(`Starting a cloud sandbox for ${sandboxLabel}…`),
			],
			provisioningEvent,
		)
		this.options.clearTurnOutcome()
		this.options.setTurnPhase("streaming")
		this.options.postStateToWebview().catch(() => {})

		let sessionId: string | undefined
		let entry: CloudSessionEntry | undefined
		let host: SdkSessionHost | undefined
		let sent = false
		try {
			const config = await this.cloudSessionConfig(modelId)
			if (isStale()) return undefined
			let shownPhase: CloudProvisioningPhase | undefined
			const record = await this.options.cloudSessions.createSession(
				{ modelId, repoUrl: input.repoUrl, branch: input.branch },
				(id) => {
					sessionId = id
					if (startGeneration === this.startGeneration) this.pendingStartSessionId = id
					this.rememberPendingStart(id)
				},
				cancelSignal,
				(phase) => {
					const text = phase === shownPhase ? undefined : provisioningPhaseText(phase, sandboxLabel)
					if (!text || isStale()) return
					shownPhase = phase
					// Same ts: the progress row is updated in place, not appended.
					this.options.messages.appendAndEmit([provisioningRow(text)], provisioningEvent)
				},
			)
			sessionId = record.id
			if (isStale()) return sessionId
			entry = this.upsertRecord(record)
			entry.title = title
			this.options.invalidateHistoryCache()
			// The task id becomes the outer session id once provisioning succeeds.
			task.taskId = record.id
			await this.options.cloudSessions.renameSession(record.id, title).catch(() => undefined)
			if (isStale()) return sessionId
			const resolvedPrompt = await this.options.resolveContextMentions(input.prompt)
			if (isStale()) return sessionId

			host = await this.connect(entry)
			if (isStale()) return sessionId
			const startInput: StartSessionInput = {
				config: { ...config, sessionId: record.id },
				interactive: true,
				prompt: undefined,
				userImages: input.images,
				sessionMetadata: { title, modelId, executionTarget: "cloud", repoUrl: input.repoUrl, branch: input.branch },
			}
			const { sdkHost } = await this.options.sessions.startNewSession(startInput, host, () => !isStale())
			if (isStale()) return sessionId
			this.options.postStateToWebview().catch(() => {})
			// From here the sandbox may hold the user's work, so recovery must never delete it.
			// Throws if the record cannot be dropped; the start then fails and deletes the sandbox.
			this.journal?.remove(record.id)
			this.options.sessions.fireAndForgetSend(sdkHost, record.id, resolvedPrompt, input.images)
			sent = true
			Logger.log(`[CloudSessions] Cloud task started: ${record.id}`)
			return record.id
		} catch (error) {
			if (isStale()) return sessionId
			Logger.error("[CloudSessions] Failed to start cloud task:", error)
			const detail = error instanceof Error ? error.message : String(error)
			this.options.messages.appendAndEmit(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "error",
						text: `Failed to start the cloud session: ${detail}`,
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: sessionId ?? provisionalId, status: "error" } },
			)
			this.options.onStartFailed(task, input)
			this.options.setTurnPhase("error")
			await this.options.postStateToWebview().catch(() => {})
			return undefined
		} finally {
			if (sessionId && !sent) await this.cleanupUnusedSession(sessionId, entry, host)
		}
	}

	private async cleanupUnusedSession(sessionId: string, entry?: CloudSessionEntry, host?: SdkSessionHost): Promise<void> {
		if (entry && this.entries.get(sessionId) === entry) {
			this.entries.delete(sessionId)
			this.options.invalidateHistoryCache()
		}
		let failed = false
		if (host) {
			await this.options.sessions.endActiveSessionIfHost(host, "cloudStartSuperseded").catch(() => {
				failed = true
			})
			await host.dispose("cloudStartSuperseded").catch(() => {
				failed = true
			})
		}
		await this.options.cloudSessions.deleteSession(sessionId).then(
			() => this.forgetPendingStart(sessionId),
			(error: unknown) => {
				if (error instanceof CloudSessionError && error.code === "session_not_found") {
					this.forgetPendingStart(sessionId)
					return
				}
				failed = true
			},
		)
		if (failed) {
			// Do not log response bodies or credentials, or retry with another account.
			const message =
				"Cloud sandbox cleanup could not be confirmed. Open History in the account that started it and delete the unused cloud session."
			Logger.warn(`[CloudSessions] ${message}`)
			void HostProvider.window.showMessage({ type: ShowMessageType.WARNING, message }).catch(() => {
				Logger.warn("[CloudSessions] Could not display the cloud cleanup warning.")
			})
		}
	}

	// ---- Reopening a task from History ----

	async openCloudTask(sessionId: string): Promise<HistoryItem | undefined> {
		const displayed = this.options.getTask()
		if (
			displayed &&
			displayed === this.pendingStartTask &&
			(sessionId === displayed.taskId || sessionId === this.pendingStartSessionId) &&
			this.renewPendingStartView?.()
		) {
			// Back on the start that is already on screen: it keeps the view, and any
			// selection still loading since is rejected instead of replacing it.
			return {
				id: sessionId,
				ts: Date.now(),
				task: "",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				executionTarget: "cloud",
				cloudStatus: "provisioning",
			}
		}
		const lookupWasSuperseded = this.options.claimTaskViewGeneration()
		const generationBeforeTransition = this.scopeGeneration
		await this.scopeTransition
		if (generationBeforeTransition !== this.scopeGeneration) return undefined
		const lookupGeneration = generationBeforeTransition
		const record = await this.findHistoryRecord(sessionId)
		if (lookupWasSuperseded() || lookupGeneration !== this.scopeGeneration) return undefined
		if (!record) {
			Logger.error(`[CloudSessions] Cloud session not found: ${sessionId}`)
			return undefined
		}
		const entry = this.entries.get(sessionId)
		if (!entry) {
			return undefined
		}
		const historyItem = sessionHistoryRecordToHistoryItem(record)

		// Keep the claim clearTask made: claiming again after the await would
		// override a selection the user made while the view was clearing.
		const isSuperseded = await this.options.clearTask()
		const generation = this.scopeGeneration
		const isStale = () =>
			this.disposed || isSuperseded() || generation !== this.scopeGeneration || this.entries.get(sessionId) !== entry
		if (isStale()) return historyItem

		// Pin the host so a concurrent status resolution or idle sweep does not
		// close it between connecting and installing the task that owns it.
		entry.pinned++
		// The resume notice is posted as its own render. Whatever replaces it must
		// start a new epoch right before it is installed, with no await between, or
		// the webview merges it into the notice instead of replacing it.
		let showedResumeNotice = false
		const installReplacingNotice = () => {
			if (showedResumeNotice) this.options.resetMessageTranslator()
			return this.installTask(sessionId)
		}
		try {
			this.options.resetMessageTranslator()
			const status = this.statusOf(entry)
			let messages: ClineMessage[] = []
			let attachedRunning = false
			let observedStatus = status
			if (status === "expired") {
				messages = await this.renderExpired(entry)
				if (isStale()) return historyItem
			} else if (entry.record.status?.toLowerCase() === "failed" && !entry.host) {
				// Only the control plane's record says the sandbox failed; a remembered
				// "failed" is the last agent turn's outcome, and that conversation can continue.
				messages.push({
					ts: Date.now(),
					type: "say",
					say: "error",
					text: `The cloud sandbox failed to start${entry.record.metadata.statusReason ? `: ${entry.record.metadata.statusReason}` : "."}`,
					partial: false,
				})
			} else {
				let host = await this.connectUnlessSuspended(entry)
				if (!host) {
					if (isStale()) return historyItem
					showedResumeNotice = true
					await this.resume(entry, historyItem.task)
					if (isStale()) return historyItem
					host = await this.connect(entry)
				}
				if (isStale()) {
					return historyItem
				}
				const transcript = (await host.readMessages(sessionId)) as SdkMessage[]
				if (isStale()) return historyItem
				attachedRunning = host.status === "running"
				messages = this.renderTranscript(transcript, host.status === "completed")
				await this.options.sessions.attachExistingSession({
					sdkHost: host,
					sessionId,
					startConfig: { providerId: "cline", modelId: host.sessionModelId ?? record.model ?? "" },
					isRunning: attachedRunning,
					shouldContinue: () => !isStale(),
				})
				observedStatus = host.status
				attachedRunning = observedStatus === "running"
			}
			if (isStale()) {
				return historyItem
			}

			const finalized = this.options.messages.finalizeMessagesForSave(messages)
			if (!attachedRunning && observedStatus !== "expired" && observedStatus !== "failed" && finalized.length > 0) {
				finalized.push({
					ts: Date.now(),
					type: "ask",
					ask: observedStatus === "completed" ? "resume_completed_task" : "resume_task",
					text: "",
				})
			}
			const task = installReplacingNotice()
			if (finalized.length > 0) {
				task.messageStateHandler.addMessages(finalized)
			}
			entry.lastActivityAt = Date.now()
			if (attachedRunning) {
				this.options.setTurnPhase("streaming")
			} else if (observedStatus === "completed") {
				this.options.setTurnPhase("completed", finalized.at(-1)?.ts)
			} else {
				this.options.setTurnPhase("idle")
			}
			await this.options.postStateToWebview()
			Logger.log(`[CloudSessions] Showing cloud task ${sessionId} (${status})`)
		} catch (error) {
			// The task-view claim guards error rendering as well as successful attachment.
			if (isStale()) return historyItem
			Logger.error("[CloudSessions] Failed to open cloud task:", error)
			const { messages, deleted } = await this.explainConnectFailure(entry, error)
			if (isStale()) return historyItem
			const task = installReplacingNotice()
			task.messageStateHandler.addMessages(messages)
			this.options.setTurnPhase("idle")
			if (deleted) {
				// A retained host from an earlier observation has nothing left to watch.
				const retained = entry.host
				entry.host = undefined
				this.entries.delete(sessionId)
				this.options.invalidateHistoryCache()
				await retained?.dispose("deleted").catch(() => undefined)
			}
			await this.options.postStateToWebview().catch(() => {})
		} finally {
			entry.pinned--
		}
		return historyItem
	}

	/**
	 * Connects to a session's sandbox, or returns undefined when the control
	 * plane has suspended it. The listed record may predate the suspension, so
	 * a refused connection asks the control plane for the live status.
	 */
	private async connectUnlessSuspended(entry: CloudSessionEntry): Promise<CloudSessionHost | undefined> {
		if (entry.record.status?.toLowerCase() === "suspended") return undefined
		try {
			return await this.connect(entry)
		} catch (error) {
			const live = await this.options.cloudSessions.getStatus(entry.record.id).catch(() => undefined)
			if (live?.status?.toLowerCase() === "suspended") return undefined
			throw error
		}
	}

	/**
	 * Wakes a suspended sandbox so it accepts connections again. The task view
	 * shows a notice meanwhile, and the composer stays disabled because the
	 * session reads as provisioning until the sandbox is back.
	 */
	private async resume(entry: CloudSessionEntry, title: string): Promise<void> {
		const suspended = entry.record
		const resuming = { ...suspended, status: "provisioning" }
		entry.record = resuming
		const startedAt = Date.now()
		this.installTask(suspended.id).messageStateHandler.addMessages([
			{ ts: startedAt, type: "say", say: "task", text: title, partial: false },
			{ ts: startedAt + 1, type: "say", say: "text", text: "Resuming the cloud sandbox…", partial: false },
		])
		await this.options.postStateToWebview()
		try {
			await this.options.cloudSessions.resumeSession(suspended.id)
		} catch (error) {
			if (entry.record === resuming) entry.record = suspended
			throw error
		}
		entry.record = { ...entry.record, status: "ready" }
		// A host kept from before the suspension still believes the conversation's
		// runtime is live; the resumed Hub has none, so reconnect from scratch.
		const retained = entry.host
		entry.host = undefined
		await retained?.dispose("resumed").catch(() => undefined)
	}

	/**
	 * The archived conversation of a retired sandbox, followed by a notice. The
	 * control plane archives a transcript only when a viewer disconnects from a
	 * live sandbox, so an old or never-viewed session may have none; the notice
	 * tells the cases apart instead of showing an empty error. An archive with
	 * no messages is treated as none, so the notice never points at rows that
	 * are not there.
	 */
	private async renderExpired(entry: CloudSessionEntry): Promise<ClineMessage[]> {
		let archived: SdkMessage[] | undefined
		let archiveError: string | undefined
		try {
			const history = await this.options.cloudSessions.getHistory(entry.record.id)
			archived = history?.length ? (history as SdkMessage[]) : undefined
		} catch (error) {
			archiveError = error instanceof Error ? error.message : String(error)
		}
		// Retirement says nothing about whether the last turn finished, so the
		// final response stays a plain text row rather than a completion box.
		const messages = archived ? this.renderTranscript(archived, false) : []
		messages.push({
			ts: Date.now(),
			type: "say",
			say: "info",
			text: describeExpiredCloudSession(entry.record, archived, archiveError),
			partial: false,
		})
		return messages
	}

	/**
	 * Explains a failed sandbox connection. The Hub client reports the proxy's
	 * refusal only as "Unexpected server response", so ask the control plane
	 * why: a session deleted elsewhere (for example from the dashboard) is
	 * reported as `deleted` so the caller drops it from History; one retired
	 * since the list was fetched is shown as expired. Retirement arrives either
	 * as a 410 from `/status` or as a 200 whose status is `expired`.
	 */
	private async explainConnectFailure(
		entry: CloudSessionEntry,
		error: unknown,
	): Promise<{ messages: ClineMessage[]; deleted: boolean }> {
		const probe = await this.options.cloudSessions.getStatus(entry.record.id).then(
			(status) => (status.status?.toLowerCase() === "expired" ? ("session_expired" as const) : undefined),
			(probeError: unknown) => (probeError instanceof CloudSessionError ? probeError.code : undefined),
		)
		if (probe === "session_expired") {
			return { messages: await this.renderExpired(entry), deleted: false }
		}
		const notice = (say: "info" | "error", text: string): ClineMessage[] => [
			{ ts: Date.now(), type: "say", say, text, partial: false },
		]
		if (probe === "session_not_found") {
			return {
				messages: notice(
					"info",
					"This cloud session was deleted, so it can no longer be opened. It has been removed from History.",
				),
				deleted: true,
			}
		}
		return {
			messages: notice(
				"error",
				`Could not connect to this cloud session: ${error instanceof Error ? error.message : String(error)}`,
			),
			deleted: false,
		}
	}

	private renderTranscript(messages: SdkMessage[], finalTurnCompleted: boolean): ClineMessage[] {
		return sdkMessagesToDisplayClineMessages(messages, this.options.getMinter(), {
			finalTurnCompleted,
			cwd: CLOUD_WORKSPACE_ROOT,
		})
	}

	private installTask(taskId: string): TaskProxy {
		const task = createTaskProxy(
			taskId,
			(text, images, files) => this.options.onAskResponse(text, images, files),
			() => this.options.onCancelTask(),
		)
		this.options.setTask(task)
		return task
	}

	// ---- Deletion / disposal ----

	async deleteSession(sessionId: string): Promise<void> {
		const generation = this.scopeGeneration
		await this.scopeTransition
		const assertCurrentScope = () => {
			if (this.disposed || generation !== this.scopeGeneration) {
				throw new Error("Cloud session deletion was cancelled because its account scope changed.")
			}
		}
		assertCurrentScope()
		return this.trackScopeOperation(async () => {
			assertCurrentScope()
			const entry = this.entries.get(sessionId)
			if (entry?.host) await entry.host.dispose("deleted").catch(() => undefined)
			await this.options.cloudSessions.deleteSession(sessionId)
			if (entry && this.entries.get(sessionId) === entry) this.entries.delete(sessionId)
		})
	}

	async dispose(): Promise<void> {
		this.disposed = true
		this.cancelAbandonedStartsRecheck()
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = undefined
		}
		const hosts = [...this.entries.values()].flatMap((entry) => (entry.host ? [entry.host] : []))
		this.entries.clear()
		await this.drainScopeOperations([
			...this.scopeOperations,
			...hosts.map((host) => host.dispose("controllerDispose")),
		]).catch(() => {
			// The controller must still dispose its other services. In-flight starts
			// remain enrolled and clean their sandbox if its id arrives after this wait.
			Logger.warn("[CloudSessions] Cloud cleanup is still pending during controller disposal.")
		})
	}
}
