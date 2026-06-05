import { type AgentTool, createTool } from "@cline/shared"
import type { StateManager } from "@/core/storage/StateManager"
import { buildSessionConfig, type SessionConfigInput } from "./cline-session-factory"
import { buildAgentHooks, type HookMessageEmitter } from "./hooks-adapter"

export interface SdkSessionConfigBuilderOptions {
	stateManager: StateManager
	emitHookMessage: HookMessageEmitter
	onSwitchToActMode: () => void
	shouldStopAfterModeSwitch?: () => boolean
}

export class SdkSessionConfigBuilder {
	constructor(private readonly options: SdkSessionConfigBuilderOptions) {}

	async build(input: SessionConfigInput): Promise<Awaited<ReturnType<typeof buildSessionConfig>>> {
		const config = await buildSessionConfig(input)
		const baseHooks = buildAgentHooks(this.options.stateManager, this.options.emitHookMessage)
		config.hooks = {
			...baseHooks,
			beforeModel: async (ctx) => {
				const baseControl = await baseHooks.beforeModel?.(ctx)
				if (this.options.shouldStopAfterModeSwitch?.()) {
					return {
						...baseControl,
						stop: true,
					}
				}
				return baseControl
			},
		}
		if (input.mode === "plan") {
			// Match the CLI interactive runtime: plan-mode sessions expose a
			// switch_to_act_mode tool in addition to the read-only planning tools.
			config.extraTools = [...(config.extraTools ?? []), this.createSwitchToActModeTool()]
		} else {
			// The switch tool is plan-only in the CLI and should disappear after
			// rebuilding the session in act mode.
			config.extraTools = config.extraTools?.filter((tool) => tool.name !== "switch_to_act_mode")
		}

		return config
	}

	private createSwitchToActModeTool(): AgentTool {
		return createTool({
			name: "switch_to_act_mode",
			description:
				"Switch from plan mode to act mode. Call this after the user has confirmed they want to proceed with the plan. Do not call this proactively or before the user has agreed.",
			inputSchema: {
				type: "object",
				properties: {},
			},
			timeoutMs: 5000,
			retryable: false,
			maxRetries: 0,
			execute: async () => {
				const currentMode = this.options.stateManager.getGlobalSettingsKey("mode")
				if (currentMode === "act") {
					return "Already in act mode."
				}
				this.options.onSwitchToActMode()
				return "You successfully switched to act mode, proceed with the plan. You now have access to editing files and running commands. (The switch_to_act_mode tool is only available in plan mode.)"
			},
		})
	}
}
