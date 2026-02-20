import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import {
	ClineAskUseSubagents,
	ClineSaySubagentStatus,
	ClineSubagentUsageInfo,
	SubagentStatusItem,
} from "@shared/ExtensionMessage"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import { SubagentRunner } from "../subagent/SubagentRunner"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

const MAX_SUBAGENT_PROMPTS = 5
const PROMPT_KEYS = ["prompt_1", "prompt_2", "prompt_3", "prompt_4", "prompt_5"] as const

function excerpt(text: string | undefined, maxChars = 1200): string {
	if (!text) {
		return ""
	}

	const trimmed = text.trim()
	if (trimmed.length <= maxChars) {
		return trimmed
	}

	return `${trimmed.slice(0, maxChars)}...`
}

export class UseSubagentsToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.USE_SUBAGENTS

	getDescription(_block: ToolUse): string {
		return "[subagents]"
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const prompts = PROMPT_KEYS.map((key) => uiHelpers.removeClosingTag(block, key, block.params[key]?.trim()))
			.map((prompt) => prompt?.trim())
			.filter((prompt): prompt is string => !!prompt)

		if (prompts.length === 0) {
			return
		}

		const partialMessage = JSON.stringify({ prompts } satisfies ClineAskUseSubagents)
		const autoApproveResult = uiHelpers.shouldAutoApproveTool(this.name)
		const [shouldAutoApprove] = Array.isArray(autoApproveResult) ? autoApproveResult : [autoApproveResult, false]

		if (shouldAutoApprove) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "use_subagents")
			await uiHelpers.say("use_subagents", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "use_subagents")
			await uiHelpers.ask("use_subagents", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const subagentsEnabled = config.services.stateManager.getGlobalSettingsKey("subagentsEnabled")
		if (!subagentsEnabled) {
			return formatResponse.toolError("Subagents are disabled. Enable them in Settings > Features to use this tool.")
		}

		const prompts = PROMPT_KEYS.map((key) => block.params[key]?.trim()).filter((prompt): prompt is string => !!prompt)

		if (prompts.length === 0) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "prompt_1")
		}

		if (prompts.length > MAX_SUBAGENT_PROMPTS) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Too many subagent prompts provided (${prompts.length}). Maximum is ${MAX_SUBAGENT_PROMPTS}.`,
			)
		}

		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const approvalPayload: ClineAskUseSubagents = { prompts }
		const approvalBody = JSON.stringify(approvalPayload)

		const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(this.name)
		const [autoApproveSafe] = Array.isArray(autoApproveResult) ? autoApproveResult : [autoApproveResult, false]
		const didAutoApprove = !!autoApproveSafe

		if (didAutoApprove) {
			telemetryService.captureToolUsage(
				config.ulid,
				this.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				undefined,
				block.isNativeToolCall,
			)
		} else {
			showNotificationForApproval(
				prompts.length === 1 ? "Cline wants to use a subagent" : `Cline wants to use ${prompts.length} subagents`,
				config.autoApprovalSettings.enableNotifications,
			)
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("use_subagents", approvalBody, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					this.name,
					config.api.getModel().id,
					provider,
					false,
					false,
					undefined,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			}
			telemetryService.captureToolUsage(
				config.ulid,
				this.name,
				config.api.getModel().id,
				provider,
				false,
				true,
				undefined,
				block.isNativeToolCall,
			)
		}

		config.taskState.consecutiveMistakeCount = 0

		const entries: SubagentStatusItem[] = prompts.map((prompt, index) => ({
			index: index + 1,
			prompt,
			status: "pending",
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalCost: 0,
			contextTokens: 0,
			contextWindow: 0,
			contextUsagePercentage: 0,
			latestToolCall: undefined,
		}))

		const emitStatus = async (status: ClineSaySubagentStatus["status"], partial: boolean) => {
			const completed = entries.filter((entry) => entry.status === "completed" || entry.status === "failed").length
			const successes = entries.filter((entry) => entry.status === "completed").length
			const failures = entries.filter((entry) => entry.status === "failed").length
			const toolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
			const inputTokens = entries.reduce((acc, entry) => acc + (entry.inputTokens || 0), 0)
			const outputTokens = entries.reduce((acc, entry) => acc + (entry.outputTokens || 0), 0)
			const contextWindow = entries.reduce((acc, entry) => Math.max(acc, entry.contextWindow || 0), 0)
			const maxContextTokens = entries.reduce((acc, entry) => Math.max(acc, entry.contextTokens || 0), 0)
			const maxContextUsagePercentage = entries.reduce((acc, entry) => Math.max(acc, entry.contextUsagePercentage || 0), 0)

			const payload: ClineSaySubagentStatus = {
				status,
				total: entries.length,
				completed,
				successes,
				failures,
				toolCalls,
				inputTokens,
				outputTokens,
				contextWindow,
				maxContextTokens,
				maxContextUsagePercentage,
				items: entries,
			}

			await config.callbacks.say("subagent", JSON.stringify(payload), undefined, undefined, partial)
		}

		let statusUpdateQueue: Promise<void> = Promise.resolve()
		const queueStatusUpdate = (status: ClineSaySubagentStatus["status"], partial: boolean): Promise<void> => {
			statusUpdateQueue = statusUpdateQueue.catch(() => undefined).then(() => emitStatus(status, partial))
			return statusUpdateQueue
		}

		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "subagent")
		await queueStatusUpdate("running", true)

		const runners = prompts.map(() => new SubagentRunner(config))
		const abortPollInterval = setInterval(() => {
			if (!config.taskState.abort) {
				return
			}
			clearInterval(abortPollInterval)
			void Promise.allSettled(runners.map((runner) => runner.abort()))
		}, 100)

		const execution = prompts.map((prompt, index) =>
			runners[index].run(prompt, async (update) => {
				const current = entries[index]
				if (update.status === "running") {
					current.status = "running"
				}
				if (update.status === "completed") {
					current.status = "completed"
				}
				if (update.status === "failed") {
					current.status = "failed"
				}
				if (update.result !== undefined) {
					current.result = update.result
				}
				if (update.error !== undefined) {
					current.error = update.error
				}
				if (update.latestToolCall !== undefined) {
					current.latestToolCall = update.latestToolCall
				}
				if (update.stats) {
					current.toolCalls = update.stats.toolCalls || 0
					current.inputTokens = update.stats.inputTokens || 0
					current.outputTokens = update.stats.outputTokens || 0
					current.totalCost = update.stats.totalCost || 0
					current.contextTokens = update.stats.contextTokens || 0
					current.contextWindow = update.stats.contextWindow || 0
					current.contextUsagePercentage = update.stats.contextUsagePercentage || 0
				}
				await queueStatusUpdate("running", true)
			}),
		)

		const settled = await Promise.allSettled(execution)
		clearInterval(abortPollInterval)
		let usageTokensIn = 0
		let usageTokensOut = 0
		let usageCacheWrites = 0
		let usageCacheReads = 0
		let usageCost = 0
		settled.forEach((result, index) => {
			if (result.status === "rejected") {
				entries[index].status = "failed"
				entries[index].error = (result.reason as Error)?.message || "Subagent execution failed"
				return
			}
			entries[index].status = result.value.status
			entries[index].result = result.value.result
			entries[index].error = result.value.error
			entries[index].toolCalls = result.value.stats.toolCalls || 0
			entries[index].inputTokens = result.value.stats.inputTokens || 0
			entries[index].outputTokens = result.value.stats.outputTokens || 0
			entries[index].totalCost = result.value.stats.totalCost || 0
			entries[index].contextTokens = result.value.stats.contextTokens || 0
			entries[index].contextWindow = result.value.stats.contextWindow || 0
			entries[index].contextUsagePercentage = result.value.stats.contextUsagePercentage || 0

			usageTokensIn += result.value.stats.inputTokens || 0
			usageTokensOut += result.value.stats.outputTokens || 0
			usageCacheWrites += result.value.stats.cacheWriteTokens || 0
			usageCacheReads += result.value.stats.cacheReadTokens || 0
			usageCost += result.value.stats.totalCost || 0
		})

		const failures = entries.filter((entry) => entry.status === "failed").length
		await queueStatusUpdate(failures > 0 ? "failed" : "completed", false)

		const subagentUsagePayload: ClineSubagentUsageInfo = {
			source: "subagents",
			tokensIn: usageTokensIn,
			tokensOut: usageTokensOut,
			cacheWrites: usageCacheWrites,
			cacheReads: usageCacheReads,
			cost: usageCost,
		}
		await config.callbacks.say("subagent_usage", JSON.stringify(subagentUsagePayload))

		const successCount = entries.length - failures
		const totalToolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
		const maxContextUsagePercentage = entries.reduce((acc, entry) => Math.max(acc, entry.contextUsagePercentage || 0), 0)
		const maxContextTokens = entries.reduce((acc, entry) => Math.max(acc, entry.contextTokens || 0), 0)
		const contextWindow = entries.reduce((acc, entry) => Math.max(acc, entry.contextWindow || 0), 0)

		const summary = [
			"Subagent results:",
			`Total: ${entries.length}`,
			`Succeeded: ${successCount}`,
			`Failed: ${failures}`,
			`Tool calls: ${totalToolCalls}`,
			`Peak context usage: ${maxContextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} (${maxContextUsagePercentage.toFixed(1)}%)`,
			"",
			...entries.map((entry) => {
				const header = `[${entry.index}] ${entry.status.toUpperCase()} - ${entry.prompt}`
				const detail = entry.status === "completed" ? excerpt(entry.result) : excerpt(entry.error)
				return detail ? `${header}\n${detail}` : header
			}),
		].join("\n")

		return formatResponse.toolResult(summary)
	}
}
