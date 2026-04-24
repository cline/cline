import { createTool, type Tool } from "@clinebot/shared"
import type { StateManager } from "@/core/storage/StateManager"
import { buildSessionConfig, type SessionConfigInput } from "./cline-session-factory"
import { buildAgentHooks, buildHookExtensions, type HookMessageEmitter } from "./hooks-adapter"

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
			onBeforeAgentStart: async (ctx) => {
				const baseControl = await baseHooks.onBeforeAgentStart?.(ctx)
				if (this.options.shouldStopAfterModeSwitch?.()) {
					return {
						...baseControl,
						cancel: true,
					}
				}
				return baseControl
			},
		}
		config.extensions = [
			...(config.extensions ?? []),
			...buildHookExtensions(this.options.stateManager, this.options.emitHookMessage),
		]

		if (input.mode === "plan") {
			config.extraTools = [...(config.extraTools ?? []), this.createSwitchToActModeTool()]
		}

		return config
	}

	private createSwitchToActModeTool(): Tool {
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
				return "Act mode switch queued. Stop this turn now; the session will restart in act mode before any editing, command, or other act-mode tools are available."
			},
		})
	}
}
