import type { ApiConfiguration } from "@shared/api"
import type { ClineApiReqInfo, ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { parseProviderId } from "./model-catalog/provider-id"
import { resolveRuntimeModelSelection } from "./model-catalog/store"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkProviderChangeCoordinator } from "./sdk-provider-change-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import type { SdkTaskHistory } from "./sdk-task-history"
import type { TaskProxy } from "./task-proxy"

/** Warn once accumulated context reaches this fraction of the target model's context window. */
const CONTEXT_OVERFLOW_WARNING_THRESHOLD = 0.9

export interface SdkMultichatCoordinatorOptions {
	stateManager: StateManager
	providerChanges: SdkProviderChangeCoordinator
	sessions: Pick<SdkSessionLifecycle, "getActiveSession">
	rebuilds: Pick<SdkSessionRebuildScheduler, "request" | "waitUntilSettled">
	taskHistory: Pick<SdkTaskHistory, "findHistoryItem" | "updateTaskHistoryItem">
	messages: Pick<SdkMessageCoordinator, "appendAndEmit">
	getTask: () => TaskProxy | undefined
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Detects a "<Backend name>, ..." / "<Backend name>: ..." / "<Backend name> ..."
 * prefix in a chat message and switches the live ApiConfiguration onto that
 * named backend mid-conversation — Cline's take on addressing a specific model
 * in a multi-model group chat (see plan doc "Multi-backend multichat switching").
 *
 * The name only has to appear as a whole word at the very start of the message
 * (punctuation after it is optional) — e.g. both "Opus, thoughts?" and "Opus
 * what do you think?" trigger a switch to a backend named "Opus". This is
 * deliberately permissive: a message that merely *starts* with a word matching
 * a backend's name (e.g. "Sonnet is a nice poem form") will also match. Tighten
 * to require punctuation (`[,:]`, no `?`) if that trade-off is a problem.
 */
export class SdkMultichatCoordinator {
	constructor(private readonly options: SdkMultichatCoordinatorOptions) {}

	/**
	 * Returns the matched backend name if a trigger was recognized (whether or
	 * not it actually caused a restart — e.g. it may already be the active
	 * backend), or undefined if the message doesn't address a known backend by
	 * name.
	 *
	 * @param restartActiveSession When false, only the persisted ApiConfiguration
	 * is switched (and the participant tracked) — the caller is about to build
	 * its own replacement session anyway (e.g. editMessageAndRegenerate) and
	 * restarting the still-live one here would race that caller's own teardown.
	 */
	async detectAndSwitch(
		text: string | undefined,
		options: { restartActiveSession?: boolean } = {},
	): Promise<string | undefined> {
		const restartActiveSession = options.restartActiveSession ?? true
		const trimmed = text?.trimStart()
		if (!trimmed) {
			return undefined
		}

		const defaultBackendName = (this.options.stateManager.getGlobalSettingsKey("defaultBackendName") || "").trim()
		const namedApiBackends = this.options.stateManager.getGlobalSettingsKey("namedApiBackends") || []

		const candidates: Array<{ name: string; config?: ApiConfiguration }> = [
			...(defaultBackendName ? [{ name: defaultBackendName, config: undefined }] : []),
			...namedApiBackends
				.filter((backend) => backend.name.trim())
				.map((backend) => ({ name: backend.name.trim(), config: backend.config })),
		]

		const match = candidates.find(({ name }) => new RegExp(`^\\s*${escapeRegExp(name)}\\b[,:]?\\s+`, "i").test(trimmed))
		if (!match) {
			return undefined
		}

		if (match.name === defaultBackendName) {
			// Already the active backend for this task; addressing it by name is
			// still a legitimate multichat message, just not a switch.
			await this.trackParticipant(match.name)
			return match.name
		}

		const activeSession = restartActiveSession ? this.options.sessions.getActiveSession() : undefined
		if (activeSession?.isRunning) {
			// A response is still streaming. There is no safe way to redirect the
			// message that's already about to be queued to the outgoing session,
			// so leave the switch for the user's next message rather than risk a
			// send racing a session swap.
			Logger.log(`[SdkMultichatCoordinator] "${match.name}" trigger seen mid-turn; deferring switch to next message`)
			this.emitInfo(
				`Will switch to "${match.name}" once the current response finishes — send your message again after that.`,
				activeSession.sessionId,
			)
			return undefined
		}

		if (!match.config) {
			// Only the (excluded-above) already-active default entry lacks a config.
			return undefined
		}

		await this.trackParticipant(defaultBackendName || match.name)
		await this.trackParticipant(match.name)

		this.warnIfContextWillOverflow(match.config, match.name, activeSession?.sessionId)

		this.options.stateManager.setApiConfiguration(structuredClone(match.config))
		this.options.stateManager.setGlobalState("defaultBackendName", match.name)

		if (activeSession) {
			Logger.log(`[SdkMultichatCoordinator] Switching active backend to "${match.name}"`)
			// Provider ids alone can't distinguish two named backends on the same
			// provider (e.g. two Anthropic configs with different models/keys), so
			// this always restarts rather than reusing handleApiConfigurationChanged's
			// provider-equality gate. Routed through the rebuild scheduler (not called
			// directly) so it serializes against any other pending session rebuild.
			this.options.rebuilds.request("provider", () => this.options.providerChanges.restartActiveSessionForProviderChange())
			await this.options.rebuilds.waitUntilSettled()
			this.emitInfo(`Switched to backend "${match.name}".`, activeSession.sessionId, match.name)
		} else {
			Logger.log(
				`[SdkMultichatCoordinator] Set default backend to "${match.name}" (${
					restartActiveSession ? "no active session to restart" : "caller owns its own session rebuild"
				})`,
			)
		}

		return match.name
	}

	/**
	 * Best-effort: warns when the conversation accumulated so far already uses
	 * most of the target backend's context window, since mixing models with
	 * different (often much smaller) windows mid-conversation is an easy way to
	 * silently truncate history or hit a hard context error. Any lookup failure
	 * (custom/unknown provider, no catalog entry, no prior request yet) just
	 * skips the check — this must never block or break a switch.
	 */
	private warnIfContextWillOverflow(targetConfig: ApiConfiguration, targetName: string, sessionId: string | undefined): void {
		try {
			const providerRaw = targetConfig.actModeApiProvider ?? targetConfig.planModeApiProvider
			const modelId = targetConfig.actModeApiModelId ?? targetConfig.planModeApiModelId
			if (!providerRaw || !modelId) {
				return
			}
			const contextWindow = resolveRuntimeModelSelection(parseProviderId(providerRaw), modelId).modelInfo?.contextWindow
			if (!contextWindow) {
				return
			}

			const messages = this.options.getTask()?.messageStateHandler.getClineMessages() ?? []
			let lastTokensIn: number | undefined
			for (let i = messages.length - 1; i >= 0; i--) {
				const candidate = messages[i]
				if (candidate.say !== "api_req_started" || !candidate.text) {
					continue
				}
				const info: ClineApiReqInfo = JSON.parse(candidate.text)
				if (typeof info.tokensIn === "number") {
					lastTokensIn = info.tokensIn
					break
				}
			}
			if (lastTokensIn === undefined || lastTokensIn < contextWindow * CONTEXT_OVERFLOW_WARNING_THRESHOLD) {
				return
			}

			this.emitInfo(
				`⚠️ This conversation is already using about ${lastTokensIn.toLocaleString()} tokens of context, and "${targetName}" has a ${contextWindow.toLocaleString()}-token context window. Switching now may truncate earlier history or fail outright — consider compacting the conversation first, or starting a fresh task with "${targetName}".`,
				sessionId,
			)
		} catch (error) {
			Logger.warn(`[SdkMultichatCoordinator] Context-overflow check failed for "${targetName}":`, error)
		}
	}

	private emitInfo(text: string, sessionId: string | undefined, backendName?: string): void {
		const infoMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "info",
			text,
			partial: false,
			backendName,
		}
		this.options.messages.appendAndEmit([infoMessage], {
			type: "status",
			payload: { sessionId: sessionId ?? this.options.getTask()?.taskId ?? "", status: "running" },
		})
	}

	private async trackParticipant(name: string): Promise<void> {
		const trimmedName = name.trim()
		if (!trimmedName) {
			return
		}
		const taskId = this.options.getTask()?.taskId
		if (!taskId) {
			return
		}
		const historyItem = await this.options.taskHistory.findHistoryItem(taskId)
		if (!historyItem) {
			return
		}
		if (historyItem.multiModelParticipants?.includes(trimmedName)) {
			return
		}
		const updated: HistoryItem = {
			...historyItem,
			multiModelParticipants: [...(historyItem.multiModelParticipants ?? []), trimmedName],
		}
		await this.options.taskHistory.updateTaskHistoryItem(updated)
	}
}
