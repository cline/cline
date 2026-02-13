import { buildApiHandler } from "@core/api"
import { PromptRegistry } from "@core/prompts/system-prompt"
import { ClineToolSet } from "@core/prompts/system-prompt/registry/ClineToolSet"
import type { SystemPromptContext } from "@core/prompts/system-prompt/types"
import { ClineDefaultTool } from "@shared/tools"
import { ApiProvider } from "@/shared/api"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"
import type { TaskConfig } from "../types/TaskConfig"
import type { AgentBaseConfig } from "./AgentConfigLoader"
import { AgentConfigLoader } from "./AgentConfigLoader"

export type AgentConfig = Partial<AgentBaseConfig>

export const SUBAGENT_DEFAULT_ALLOWED_TOOLS: ClineDefaultTool[] = [
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.SEARCH,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.BASH,
	ClineDefaultTool.USE_SKILL,
	ClineDefaultTool.ATTEMPT,
]

export const SUBAGENT_SYSTEM_SUFFIX = `\n\n# Subagent Execution Mode
You are running as a research subagent. Your job is to thoroughly explore the codebase and gather comprehensive information to answer the question.
Explore broadly, read related files, trace through call chains, and build a complete picture before reporting back.
You can read files, list directories, search for patterns, list code definitions, and run commands.
Only use execute_command for readonly operations like ls, grep, git log, git diff, gh, etc.
Do not run commands that modify files or system state.
When you have a comprehensive answer, call the attempt_completion tool.
The attempt_completion result field is sent directly to the main agent, so put your full final findings there.
Include file paths and line numbers in that result field.
Also include a section titled "Recommended files for main agent" with a list of the highest-value files the main agent should read next, and a one-line reason for each file.
`

export class SubagentBuilder {
	private readonly agentConfig: AgentConfig = {}
	private readonly allowedTools: ClineDefaultTool[]
	private readonly apiHandler: ReturnType<typeof buildApiHandler>

	constructor(
		private readonly baseConfig: TaskConfig,
		subagentName?: string,
	) {
		const subagentConfig = AgentConfigLoader.getInstance().getCachedConfig(subagentName)
		this.agentConfig = subagentConfig ?? {}
		this.allowedTools = this.resolveAllowedTools(this.agentConfig.tools)

		const mode = this.baseConfig.services.stateManager.getGlobalSettingsKey("mode")
		const apiConfiguration = this.baseConfig.services.stateManager.getApiConfiguration()
		const effectiveApiConfiguration = {
			...apiConfiguration,
			ulid: this.baseConfig.ulid,
		} as Record<string, unknown>
		this.applyModelOverride(effectiveApiConfiguration, mode, this.agentConfig.modelId)
		this.apiHandler = buildApiHandler(effectiveApiConfiguration as typeof apiConfiguration, mode)
	}

	getApiHandler(): ReturnType<typeof buildApiHandler> {
		return this.apiHandler
	}

	getAllowedTools(): ClineDefaultTool[] {
		return this.allowedTools
	}

	buildSystemPrompt(generatedSystemPrompt: string): string {
		const configuredSystemPrompt = this.agentConfig?.systemPrompt?.trim()
		const systemPrompt = configuredSystemPrompt || generatedSystemPrompt
		return `${systemPrompt}${this.buildAgentIdentitySystemPrefix()}${SUBAGENT_SYSTEM_SUFFIX}`
	}

	buildNativeTools(context: SystemPromptContext) {
		const family = PromptRegistry.getInstance().getModelFamily(context)
		const toolSets = ClineToolSet.getToolsForVariantWithFallback(family, this.allowedTools)
		const filteredToolSpecs = toolSets
			.map((toolSet) => toolSet.config)
			.filter(
				(toolSpec) =>
					this.allowedTools.includes(toolSpec.id) &&
					(!toolSpec.contextRequirements || toolSpec.contextRequirements(context)),
			)

		const converter = ClineToolSet.getNativeConverter(context.providerInfo.providerId, context.providerInfo.model.id)
		return filteredToolSpecs.map((tool) => converter(tool, context))
	}

	private resolveAllowedTools(configuredTools?: ClineDefaultTool[]): ClineDefaultTool[] {
		const sourceTools = configuredTools && configuredTools.length > 0 ? configuredTools : SUBAGENT_DEFAULT_ALLOWED_TOOLS
		return Array.from(new Set([...sourceTools, ClineDefaultTool.ATTEMPT]))
	}

	private buildAgentIdentitySystemPrefix(): string {
		const name = this.agentConfig?.name?.trim()
		const description = this.agentConfig?.description?.trim()
		if (!name && !description) {
			return ""
		}

		const lines = ["# Agent Profile"]
		if (name) {
			lines.push(`Name: ${name}`)
		}
		if (description) {
			lines.push(`Description: ${description}`)
		}

		return `${lines.join("\n")}\n\n`
	}

	private applyModelOverride(apiConfiguration: Record<string, unknown>, _mode: string, modelId?: string): void {
		const trimmedModelId = modelId?.trim()
		if (!trimmedModelId) {
			return
		}

		const mode = _mode === "plan" ? "plan" : "act"
		const provider = apiConfiguration[_mode === "plan" ? "planModeApiProvider" : "actModeApiProvider"] as ApiProvider
		apiConfiguration[getProviderModelIdKey(provider as ApiProvider, mode)] = trimmedModelId
	}
}
