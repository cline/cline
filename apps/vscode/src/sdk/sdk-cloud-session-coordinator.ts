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

import type { ITelemetryService, SessionHistoryRecord, StartSessionInput } from "@cline/core"
import type { MessageWithMetadata as SdkMessage } from "@cline/llms"
import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared"
import {
	ACTIVE_CLOUD_STATUSES,
	CLOUD_PROVISIONING_ID_PREFIX,
	CLOUD_WORKSPACE_ROOT,
	type CloudSessionStatus,
	type CurrentCloudTaskInfo,
	isCloudSessionId,
} from "@shared/cloud/cloud-sessions"
import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { ShowMessageType } from "@shared/proto/host/window"
import type { Mode } from "@shared/storage/types"
import { refreshClineRecommendedModels } from "@/core/controller/models/refreshClineRecommendedModels"
import type { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import {
	CloudSessionError,
	type CloudSessionRecord,
	type CloudSessionsService,
	isCloudSessionExpired,
} from "@/services/cloud/CloudSessionsService"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@/shared/cline/recommended-models"
import { Logger } from "@/shared/services/Logger"
import { CloudSessionHost } from "./cloud-session-host"
import type { MessageIdMinter } from "./message-id-minter"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { sdkMessagesToDisplayClineMessages, sessionHistoryRecordToHistoryItem } from "./sdk-task-history"
import type { SdkSessionHost } from "./session-host"
import { createTaskProxy, type TaskProxy } from "./task-proxy"

const LIST_CACHE_TTL_MS = 10_000
const ACTIVE_POLL_INTERVAL_MS = 15_000
const IDLE_CONNECTION_TTL_MS = 5 * 60_000

export interface SdkCloudSessionCoordinatorOptions {
	cloudSessions: CloudSessionsService
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	getMinter: () => MessageIdMinter
	getTask: () => TaskProxy | undefined
	setTask: (task: TaskProxy | undefined) => void
	onAskResponse: (text?: string, images?: string[], files?: string[]) => Promise<void>
	onCancelTask: () => Promise<void>
	/** Ends the current task view (local or cloud) before a cloud task is installed. */
	clearTask: () => Promise<void>
	claimTaskViewGeneration: () => () => boolean
	requestToolApproval: (request: ToolApprovalRequest) => Promise<ToolApprovalResult>
	getAuthToken: () => Promise<string | null | undefined>
	isSignedIn: () => boolean
	isEnabled: () => boolean
	resetMessageTranslator: () => void
	setTurnPhase: (phase: TurnPhase, anchorTs?: number) => void
	postStateToWebview: () => Promise<void>
	invalidateHistoryCache: () => void
	resolveContextMentions: (text: string) => Promise<string>
	telemetry?: ITelemetryService
}

interface CloudSessionEntry {
	record: CloudSessionRecord
	/** Live connection, when this extension instance is attached to the sandbox. */
	host?: CloudSessionHost
	connection?: Promise<CloudSessionHost>
	/** Last agent status observed over the connection, kept after it is dropped. */
	agentStatus?: CloudSessionStatus
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
	private scopeTransition: Promise<void> | undefined

	constructor(private readonly options: SdkCloudSessionCoordinatorOptions) {}

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
		return entry.host?.status ?? entry.agentStatus ?? "idle"
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
			status: entry ? this.statusOf(entry) : "idle",
			dashboardUrl: this.options.cloudSessions.dashboardUrl(taskId),
		}
	}

	private toHistoryRecord(entry: CloudSessionEntry): SessionHistoryRecord {
		const { record } = entry
		const status = this.statusOf(entry)
		const title = entry.title ?? record.title?.trim() ?? ""
		return {
			sessionId: record.id,
			source: "vscode",
			pid: 0,
			startedAt: record.createdAt,
			endedAt: status === "expired" ? (record.expiredAt ?? undefined) : undefined,
			exitCode: 0,
			status: status === "running" || status === "provisioning" ? "running" : status === "failed" ? "failed" : "completed",
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
				git: { url: record.repoContext.repoUrl, branch: record.repoContext.branch },
			},
			// Keep a task the user is actively working on at the top of History.
			updatedAt: new Date(Math.max(Date.parse(record.updatedAt) || 0, entry.lastActivityAt)).toISOString(),
		}
	}

	/** History rows for every cloud session in the active account scope (cached briefly). */
	async listHistoryRecords(): Promise<SessionHistoryRecord[]> {
		if (!this.isAvailable()) {
			return []
		}
		await this.refreshList()
		return [...this.entries.values()].map((entry) => this.toHistoryRecord(entry))
	}

	async findHistoryRecord(sessionId: string): Promise<SessionHistoryRecord | undefined> {
		if (!this.isAvailable()) {
			return undefined
		}
		let entry = this.entries.get(sessionId)
		if (!entry) {
			await this.refreshList(true)
			entry = this.entries.get(sessionId)
		}
		return entry ? this.toHistoryRecord(entry) : undefined
	}

	private async refreshList(force = false): Promise<void> {
		await this.scopeTransition
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
				const records = await this.options.cloudSessions.listSessions()
				if (generation !== this.scopeGeneration) {
					return
				}
				const seen = new Set<string>()
				for (const record of records) {
					seen.add(record.id)
					this.upsertRecord(record)
				}
				for (const [id, entry] of this.entries) {
					if (!seen.has(id) && !entry.host) {
						this.entries.delete(id)
					}
				}
				this.listFetchedAt = Date.now()
			} catch (error) {
				if (error instanceof CloudSessionError && error.code === "authentication_required") {
					this.entries.clear()
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
			return existing
		}
		const entry: CloudSessionEntry = { record, lastActivityAt: Date.parse(record.updatedAt) || Date.now() }
		this.entries.set(record.id, entry)
		return entry
	}

	/** Changes account scope as one boundary: invalidate, detach, dispose, mutate scope, then reopen reads. */
	async reset(changeScope?: () => Promise<void>): Promise<void> {
		this.scopeGeneration++
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
			// Late connectors reject by generation and dispose the host they created;
			// wait for that ownership transfer before changing account credentials.
			await Promise.allSettled(connections)
			await Promise.allSettled(hosts.map((host) => host.dispose("accountScopeChanged")))
			await changeScope?.()
		})()
		this.scopeTransition = transition
		try {
			await transition
		} finally {
			if (this.scopeTransition === transition) {
				this.scopeTransition = undefined
			}
		}
	}

	// ---- Connections ----

	private async connect(entry: CloudSessionEntry): Promise<CloudSessionHost> {
		if (entry.host) {
			return entry.host
		}
		if (entry.connection) {
			return entry.connection
		}
		const sessionId = entry.record.id
		const generation = this.scopeGeneration
		const connection = (async () => {
			const host = await CloudSessionHost.connect({
				outerSessionId: sessionId,
				socketUrl: this.options.cloudSessions.sessionSocketUrl(sessionId),
				getAuthToken: this.options.getAuthToken,
				requestToolApproval: this.options.requestToolApproval,
				telemetry: this.options.telemetry,
				getMode: () => this.getCurrentMode(),
				onStatusChange: (status) => this.handleStatusChange(sessionId, status),
			})
			if (generation !== this.scopeGeneration || this.entries.get(sessionId) !== entry) {
				await host.dispose("accountScopeChanged").catch(() => undefined)
				throw new Error("Cloud session connection was superseded")
			}
			entry.host = host
			entry.agentStatus = host.status
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
		entry.agentStatus = status
		entry.lastActivityAt = Date.now()
		this.options.invalidateHistoryCache()
		const isDisplayed = this.options.getTask()?.taskId === sessionId
		if (!isDisplayed && previous === "running" && (status === "completed" || status === "failed" || status === "idle")) {
			this.notifyFinished(entry, status)
		}
		this.options.postStateToWebview().catch(() => {})
	}

	private notifyFinished(entry: CloudSessionEntry, status: CloudSessionStatus): void {
		const title = entry.title ?? entry.record.title?.trim() ?? entry.record.repoContext.repoUrl ?? entry.record.id
		const label = status === "failed" ? "Cloud task failed" : "Cloud task finished"
		HostProvider.window
			.showMessage({
				type: status === "failed" ? ShowMessageType.WARNING : ShowMessageType.INFORMATION,
				message: `${label}: ${title}`,
				options: { items: ["Open"] },
			})
			.then((response) => {
				if (response.selectedOption === "Open") {
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
		const displayedId = this.options.getTask()?.taskId
		const now = Date.now()
		for (const entry of this.entries.values()) {
			const status = this.statusOf(entry)
			if (
				entry.host &&
				entry.record.id !== displayedId &&
				!ACTIVE_CLOUD_STATUSES.has(status) &&
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

	private getCurrentMode(): Mode {
		return this.options.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
	}

	/** The Cline model the sandbox should run: the user's current Cline model, else the top recommendation. */
	private async resolveCloudModelId(): Promise<string> {
		const apiConfig = this.options.stateManager.getApiConfiguration()
		const mode = this.getCurrentMode()
		const provider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		if (provider === "cline") {
			const modelId = mode === "plan" ? apiConfig.planModeClineModelId : apiConfig.actModeClineModelId
			if (modelId?.trim()) {
				return modelId.trim()
			}
		}
		const recommended = await refreshClineRecommendedModels().catch(() => CLINE_RECOMMENDED_MODELS_FALLBACK)
		return recommended.recommended[0]?.id ?? CLINE_RECOMMENDED_MODELS_FALLBACK.recommended[0].id
	}

	async startCloudTask(input: {
		prompt: string
		images?: string[]
		repoUrl: string
		branch?: string
	}): Promise<string | undefined> {
		const generationBeforeTransition = this.scopeGeneration
		await this.scopeTransition
		if (generationBeforeTransition !== this.scopeGeneration) return undefined
		// clearTask bumps the task-view generation itself, so claim ours after it.
		await this.options.clearTask()
		const isSuperseded = this.options.claimTaskViewGeneration()
		const generation = generationBeforeTransition
		const startedAt = Date.now()
		const provisionalId = `${CLOUD_PROVISIONING_ID_PREFIX}${startedAt}`
		const task = this.installTask(provisionalId)
		const title = input.prompt.trim().split("\n")[0]?.trim().slice(0, 120) || input.prompt.trim()
		const repoLabel = input.repoUrl.replace(/^https:\/\/github\.com\//, "")

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
				{
					ts: startedAt + 1,
					type: "say",
					say: "text",
					text: `Starting a cloud sandbox for ${repoLabel}${input.branch ? ` (${input.branch})` : ""}…`,
					partial: false,
				},
			],
			{ type: "status", payload: { sessionId: provisionalId, status: "running" } },
		)
		this.options.setTurnPhase("streaming")
		this.options.postStateToWebview().catch(() => {})

		let sessionId: string | undefined
		try {
			const modelId = await this.resolveCloudModelId()
			const record = await this.options.cloudSessions.createSession(
				{ modelId, repoUrl: input.repoUrl, branch: input.branch },
				(id) => {
					sessionId = id
				},
			)
			sessionId = record.id
			if (isSuperseded() || generation !== this.scopeGeneration) {
				await this.options.cloudSessions.deleteSession(record.id).catch(() => undefined)
				return sessionId
			}
			const entry = this.upsertRecord(record)
			entry.title = title
			this.options.invalidateHistoryCache()
			// The task id becomes the outer session id once provisioning succeeds.
			task.taskId = record.id
			this.options.cloudSessions.renameSession(record.id, title).catch(() => undefined)

			const host = await this.connect(entry)
			if (isSuperseded() || generation !== this.scopeGeneration) {
				await host.dispose("cloudStartSuperseded").catch(() => undefined)
				this.entries.delete(record.id)
				await this.options.cloudSessions.deleteSession(record.id).catch(() => undefined)
				return sessionId
			}
			const startInput: StartSessionInput = {
				config: {
					providerId: "cline",
					modelId,
					cwd: CLOUD_WORKSPACE_ROOT,
					workspaceRoot: CLOUD_WORKSPACE_ROOT,
					mode: this.getCurrentMode(),
					sessionId: record.id,
					// CloudSessionHost prepends the sandbox's GitHub-auth instructions.
					systemPrompt: "",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				interactive: true,
				prompt: undefined,
				userImages: input.images,
				sessionMetadata: { title, modelId, executionTarget: "cloud", repoUrl: input.repoUrl, branch: input.branch },
			}
			const { sdkHost } = await this.options.sessions.startNewSession(
				startInput,
				host,
				() => !isSuperseded() && generation === this.scopeGeneration,
			)
			if (isSuperseded() || generation !== this.scopeGeneration) {
				await this.cleanupSupersededSession(record.id, sdkHost)
				return sessionId
			}
			this.options.postStateToWebview().catch(() => {})
			const resolvedPrompt = await this.options.resolveContextMentions(input.prompt)
			if (isSuperseded() || generation !== this.scopeGeneration) {
				await this.cleanupSupersededSession(record.id, sdkHost)
				return sessionId
			}
			this.options.sessions.fireAndForgetSend(sdkHost, record.id, resolvedPrompt, input.images)
			Logger.log(`[CloudSessions] Cloud task started: ${record.id}`)
			return record.id
		} catch (error) {
			if (isSuperseded() || generation !== this.scopeGeneration) {
				if (sessionId) {
					const entry = this.entries.get(sessionId)
					await entry?.host?.dispose("cloudStartSuperseded").catch(() => undefined)
					this.entries.delete(sessionId)
					await this.options.cloudSessions.deleteSession(sessionId).catch(() => undefined)
				}
				return sessionId
			}
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
			this.options.setTurnPhase("error")
			await this.options.postStateToWebview().catch(() => {})
			return undefined
		}
	}

	private async cleanupSupersededSession(sessionId: string, host: SdkSessionHost): Promise<void> {
		await this.options.sessions.endActiveSessionIfHost(host, "cloudStartSuperseded")
		await host.dispose("cloudStartSuperseded").catch(() => undefined)
		this.entries.delete(sessionId)
		await this.options.cloudSessions.deleteSession(sessionId).catch(() => undefined)
	}

	// ---- Reopening a task from History ----

	async openCloudTask(sessionId: string): Promise<HistoryItem | undefined> {
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

		// clearTask bumps the task-view generation itself, so claim ours after it.
		await this.options.clearTask()
		const isSuperseded = this.options.claimTaskViewGeneration()
		const generation = this.scopeGeneration
		const isStale = () => isSuperseded() || generation !== this.scopeGeneration

		try {
			this.options.resetMessageTranslator()
			const status = this.statusOf(entry)
			let messages: ClineMessage[] = []
			let attachedRunning = false
			if (status === "expired") {
				const archived = await this.options.cloudSessions.getHistory(sessionId).catch(() => null)
				if (isStale()) return historyItem
				messages = this.renderTranscript((archived ?? []) as SdkMessage[], true)
				messages.push({
					ts: Date.now(),
					type: "say",
					say: "error",
					text: "This cloud session has expired and its sandbox is gone. The transcript is read-only; start a new cloud task to continue this work.",
					partial: false,
				})
			} else if (status === "failed" && !entry.host) {
				messages.push({
					ts: Date.now(),
					type: "say",
					say: "error",
					text: `The cloud sandbox failed to start${entry.record.metadata.statusReason ? `: ${entry.record.metadata.statusReason}` : "."}`,
					partial: false,
				})
			} else {
				const host = await this.connect(entry)
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
			}
			if (isStale()) {
				return historyItem
			}

			const finalized = this.options.messages.finalizeMessagesForSave(messages)
			if (!attachedRunning && status !== "expired" && status !== "failed" && finalized.length > 0) {
				finalized.push({ ts: Date.now(), type: "ask", ask: "resume_completed_task", text: "" })
			}
			const task = this.installTask(sessionId)
			if (finalized.length > 0) {
				task.messageStateHandler.addMessages(finalized)
			}
			entry.lastActivityAt = Date.now()
			if (attachedRunning) {
				this.options.setTurnPhase("streaming")
			} else if (status === "expired" || status === "failed") {
				this.options.setTurnPhase("idle")
			} else {
				this.options.setTurnPhase("completed", finalized.at(-1)?.ts)
			}
			await this.options.postStateToWebview()
			Logger.log(`[CloudSessions] Showing cloud task ${sessionId} (${status})`)
		} catch (error) {
			Logger.error("[CloudSessions] Failed to open cloud task:", error)
			const task = this.installTask(sessionId)
			task.messageStateHandler.addMessages([
				{
					ts: Date.now(),
					type: "say",
					say: "error",
					text: `Could not connect to this cloud session: ${error instanceof Error ? error.message : String(error)}`,
					partial: false,
				},
			])
			this.options.setTurnPhase("idle")
			await this.options.postStateToWebview().catch(() => {})
		}
		return historyItem
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
		const entry = this.entries.get(sessionId)
		if (entry?.host) {
			await entry.host.dispose("deleted").catch(() => undefined)
		}
		this.entries.delete(sessionId)
		await this.options.cloudSessions.deleteSession(sessionId)
	}

	async dispose(): Promise<void> {
		this.disposed = true
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = undefined
		}
		const hosts = [...this.entries.values()].flatMap((entry) => (entry.host ? [entry.host] : []))
		this.entries.clear()
		await Promise.allSettled(hosts.map((host) => host.dispose("controllerDispose")))
	}
}
