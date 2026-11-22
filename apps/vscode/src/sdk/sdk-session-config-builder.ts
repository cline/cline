import type { CoreSessionConfig } from "@cline/core"
import type { StateManager } from "@/core/storage/StateManager"
import { buildSessionConfig, type SessionConfigInput, type TaskModelSelection } from "./cline-session-factory"
import { buildAgentHooks, type HookMessageEmitter } from "./hooks-adapter"

export interface SdkSessionConfigBuilderOptions {
	stateManager: StateManager
	emitHookMessage: HookMessageEmitter
	onConsecutiveMistakeLimitReached?: CoreSessionConfig["onConsecutiveMistakeLimitReached"]
	/**
	 * Provider/model pinned for the task currently in view (set when a scheduled
	 * chat with its own model starts, cleared by any other task transition).
	 * Every rebuild — mode switch, provider change, MCP change, compaction —
	 * goes through this builder, so a pinned task keeps its pin instead of
	 * silently dropping to the global provider mid-conversation.
	 */
	getTaskModelSelection?: () => TaskModelSelection | undefined
}

/**
 * Unlike the CLI interactive runtime, plan-mode sessions do NOT expose a
 * switch_to_act_mode tool: matching the legacy extension, the model cannot
 * switch modes itself and must ask the user to flip the Plan/Act toggle. The
 * plan-mode system prompt (planModeSwitchTool: false in the session factory)
 * carries the matching instructions.
 */
export class SdkSessionConfigBuilder {
	constructor(private readonly options: SdkSessionConfigBuilderOptions) {}

	async build(input: SessionConfigInput): Promise<Awaited<ReturnType<typeof buildSessionConfig>>> {
		// An explicit pin on the call site wins over the task-level one, and a
		// task with no pin at all is unaffected.
		const inherited = input.modelSelection ? undefined : this.options.getTaskModelSelection?.()
		const config = await buildSessionConfig(inherited ? { ...input, modelSelection: inherited } : input)
		if (this.options.onConsecutiveMistakeLimitReached) {
			config.onConsecutiveMistakeLimitReached = this.options.onConsecutiveMistakeLimitReached
		}

		config.hooks = buildAgentHooks(this.options.stateManager, this.options.emitHookMessage, input.cwd)

		return config
	}
}
