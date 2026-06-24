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
				"Switch from plan mode to act mode. Switching to act mode immediately starts executing the plan, so only call this after the user has explicitly approved the plan in a message sent AFTER you presented it (e.g. 'looks good', 'go ahead', 'switch to act mode'). " +
				"Never call this in the same turn you present a plan, never call it proactively, and never treat the original task request as approval.",
			inputSchema: {
				type: "object",
				properties: {},
			},
			timeoutMs: 5000,
			retryable: false,
			maxRetries: 0,
			// End the run cleanly right after the tool result instead of letting the
			// loop start another iteration that the beforeModel stop hook would abort.
			// An aborted run leaves a dangling api_req_started spinner behind, which the
			// webview renders as "API Request Cancelled".
			lifecycle: {
				completesRun: true,
			},
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
