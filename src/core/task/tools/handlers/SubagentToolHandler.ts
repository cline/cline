import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ClineAskUseSubagents, ClineSaySubagentStatus, SubagentStatusItem } from "@shared/ExtensionMessage"
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
		return "[subagent batch]"
	}

	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
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
			await config.callbacks.say("use_subagents", approvalBody, undefined, undefined, false)
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
		}))

		const emitStatus = async (status: ClineSaySubagentStatus["status"], partial: boolean) => {
			const completed = entries.filter((entry) => entry.status === "completed" || entry.status === "failed").length
			const successes = entries.filter((entry) => entry.status === "completed").length
			const failures = entries.filter((entry) => entry.status === "failed").length
			const toolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
			const inputTokens = entries.reduce((acc, entry) => acc + (entry.inputTokens || 0), 0)
			const outputTokens = entries.reduce((acc, entry) => acc + (entry.outputTokens || 0), 0)

			const payload: ClineSaySubagentStatus = {
				status,
				total: entries.length,
				completed,
				successes,
				failures,
				toolCalls,
				inputTokens,
				outputTokens,
				items: entries,
			}

			await config.callbacks.say("subagent", JSON.stringify(payload), undefined, undefined, partial)
		}

		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "subagent")
		await emitStatus("running", true)

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
				if (update.stats) {
					current.toolCalls = update.stats.toolCalls || 0
					current.inputTokens = update.stats.inputTokens || 0
					current.outputTokens = update.stats.outputTokens || 0
				}
				await emitStatus("running", true)
			}),
		)

		const settled = await Promise.allSettled(execution)
		clearInterval(abortPollInterval)
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
		})

		const failures = entries.filter((entry) => entry.status === "failed").length
		await emitStatus(failures > 0 ? "failed" : "completed", false)

		const successCount = entries.length - failures
		const totalToolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
		const totalInputTokens = entries.reduce((acc, entry) => acc + (entry.inputTokens || 0), 0)
		const totalOutputTokens = entries.reduce((acc, entry) => acc + (entry.outputTokens || 0), 0)

		const summary = [
			`Subagent batch complete.`,
			`Total: ${entries.length}`,
			`Succeeded: ${successCount}`,
			`Failed: ${failures}`,
			`Tool calls: ${totalToolCalls}`,
			`Input tokens: ${totalInputTokens}`,
			`Output tokens: ${totalOutputTokens}`,
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
