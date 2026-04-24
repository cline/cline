import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import { createTaskProxy, type TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkTaskStartCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	sessionConfigBuilder: SdkSessionConfigBuilder
	buildStartSessionInput: (
		config: SessionConfig,
		input: {
			prompt?: string
			images?: string[]
			files?: string[]
			historyItem?: HistoryItem
			taskSettings?: Partial<Settings>
			cwd: string
			mode: Mode
		},
	) => StartInput
	createHistoryItemFromSession: (sessionId: string, prompt: string, modelId?: string, cwd?: string) => HistoryItem
	clearTask: () => Promise<void>
	setTask: (task: TaskProxy | undefined) => void
	onAskResponse: (text?: string, images?: string[], files?: string[]) => Promise<void>
	onCancelTask: () => Promise<void>
	getWorkspaceRoot: () => Promise<string>
	createTempSessionHost: () => Promise<{ readMessages(id: string): Promise<unknown[]>; dispose(reason: string): Promise<void> }>
	loadInitialMessages: (
		reader: { readMessages(id: string): Promise<unknown[]> },
		taskId: string,
	) => Promise<unknown[] | undefined>
	resolveContextMentions: (text: string) => Promise<string>
	isClineProviderActive: () => boolean
	emitClineAuthError: (task?: string) => void
	postStateToWebview: () => Promise<void>
}

export class SdkTaskStartCoordinator {
	constructor(private readonly options: SdkTaskStartCoordinatorOptions) {}

	async initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
	): Promise<string | undefined> {
		Logger.log(`[SdkController] initTask called: "${task?.substring(0, 50)}"`)
		try {
			await this.options.clearTask()

			const cwd = await this.options.getWorkspaceRoot()
			const mode = this.getCurrentMode()
			Logger.log(`[SdkController] Building session config: mode=${mode}, cwd=${cwd}`)
			const config = await this.options.sessionConfigBuilder.build({
				prompt: task,
				images,
				files,
				historyItem,
				taskSettings,
				cwd,
				mode,
			})

			Logger.log(
				`[SdkController] Session config: provider=${config.providerId}, model=${config.modelId}, hasApiKey=${!!config.apiKey}`,
			)

			if (config.providerId === "cline" && !config.apiKey) {
				Logger.warn("[SdkController] Cline provider selected but no auth token — emitting auth error")
				this.options.emitClineAuthError(task)
				return undefined
			}

			const startInput = this.options.buildStartSessionInput(config, {
				prompt: task,
				images,
				files,
				historyItem,
				taskSettings,
				cwd,
				mode,
			})

			const { startResult, sessionManager } = await this.options.sessions.startNewSession(startInput)
			this.createAndSetTask(startResult.sessionId)

			const newHistoryItem = this.options.createHistoryItemFromSession(
				startResult.sessionId,
				task ?? "",
				config.modelId,
				cwd,
			)
			await this.options.taskHistory.updateTaskHistory(newHistoryItem)

			this.emitInitialTaskMessage(startResult.sessionId, task ?? "")
			await this.options.postStateToWebview()

			if (task?.trim()) {
				Logger.log(`[SdkController] Sending prompt to session: ${startResult.sessionId}`)
				const resolvedTask = await this.options.resolveContextMentions(task)
				this.options.sessions.fireAndForgetSend(sessionManager, startResult.sessionId, resolvedTask, images, files)
			}

			Logger.log(`[SdkController] Task initialized: ${startResult.sessionId}`)
			return startResult.sessionId
		} catch (error) {
			this.handleInitError(error)
			return undefined
		}
	}

	async reinitExistingTaskFromId(taskId: string): Promise<void> {
		try {
			await this.options.clearTask()

			const historyItem = this.options.taskHistory.findHistoryItem(taskId)
			if (!historyItem) {
				Logger.error(`[SdkController] Task not found in history: ${taskId}`)
				return
			}

			const cwd = historyItem.cwdOnTaskInitialization ?? (await this.options.getWorkspaceRoot())
			const config = await this.options.sessionConfigBuilder.build({
				cwd,
				mode: "act",
			})

			const tempManager = await this.options.createTempSessionHost()
			const initialMessages = await this.options.loadInitialMessages(tempManager, taskId)
			await tempManager.dispose("readMessages")

			const { startResult } = await this.options.sessions.startNewSession({
				config,
				interactive: true,
				...(initialMessages ? { initialMessages: initialMessages as InitialMessages } : {}),
			})

			this.createAndSetTask(startResult.sessionId)
			await this.options.postStateToWebview()

			Logger.log(`[SdkController] Task resumed: ${taskId} → ${startResult.sessionId}`)
		} catch (error) {
			this.handleReinitError(taskId, error)
		}
	}

	private getCurrentMode(): Mode {
		const modeValue = this.options.stateManager.getGlobalSettingsKey("mode")
		return modeValue === "plan" || modeValue === "act" ? modeValue : "act"
	}

	private createAndSetTask(sessionId: string): void {
		this.options.setTask(
			createTaskProxy(
				sessionId,
				(text?: string, images?: string[], files?: string[]) => this.options.onAskResponse(text, images, files),
				() => this.options.onCancelTask(),
			),
		)
	}

	private emitInitialTaskMessage(sessionId: string, task: string): void {
		const taskMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "task",
			text: task,
			partial: false,
		}
		this.options.messages.appendAndEmit(
			[taskMessage],
			{
				type: "status",
				payload: { sessionId, status: "running" },
			},
			{ save: false },
		)
	}

	private handleInitError(error: unknown): void {
		const errorDetails =
			error instanceof Error ? `${error.name}: ${error.message}\n${error.stack?.substring(0, 500)}` : String(error)
		Logger.error(`[SdkController] Failed to init task: ${errorDetails}`)
		;(globalThis as Record<string, unknown>).__cline_last_init_error = errorDetails
		;(globalThis as Record<string, unknown>).__cline_last_init_error_raw = error
		this.options.messages.emitSessionEvents(
			[
				{
					ts: Date.now(),
					type: "say",
					say: "error",
					text: `Failed to start task: ${error instanceof Error ? error.message : String(error)}`,
					partial: false,
				},
			],
			{ type: "status", payload: { sessionId: "", status: "error" } },
		)
	}

	private handleReinitError(taskId: string, error: unknown): void {
		Logger.error("[SdkController] Failed to reinit task:", error)

		const reinitErrorMsg = error instanceof Error ? error.message : String(error)
		const isClineAuthReinit =
			this.options.isClineProviderActive() &&
			(reinitErrorMsg.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) ||
				reinitErrorMsg.toLowerCase().includes("missing api key") ||
				reinitErrorMsg.toLowerCase().includes("unauthorized"))

		if (isClineAuthReinit) {
			this.options.emitClineAuthError()
			return
		}

		this.options.messages.emitSessionEvents(
			[
				{
					ts: Date.now(),
					type: "say",
					say: "error",
					text: `Failed to resume task: ${reinitErrorMsg}`,
					partial: false,
				},
			],
			{ type: "status", payload: { sessionId: taskId, status: "error" } },
		)
	}
}
