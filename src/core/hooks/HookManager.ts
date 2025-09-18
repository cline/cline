/**
 * Hook Manager
 * Orchestrates hook execution and response handling
 */

import { ToolUse } from "@core/assistant-message"
import { EventTransformer } from "./EventTransformer"
import { HookConfigurationLoader } from "./HookConfiguration"
import { HookExecutor } from "./HookExecutor"
import { getMatchingHooks, HookConfiguration } from "./types/HookConfiguration"
import { HookEvent, HookEventNameType } from "./types/HookEvent"
import { AggregatedHookResult, aggregateHookResults } from "./types/HookResponse"

export interface HookManagerOptions {
	defaultTimeout?: number
	debug?: boolean
}

export class HookManager {
	private configLoader: HookConfigurationLoader
	private executor: HookExecutor
	private transformer: EventTransformer
	private debug: boolean

	constructor(taskId: string, cwd: string, options: HookManagerOptions = {}) {
		// Pass cwd as projectRoot to HookConfigurationLoader
		this.configLoader = new HookConfigurationLoader(cwd)
		this.executor = new HookExecutor(options.defaultTimeout)
		this.transformer = new EventTransformer(taskId, cwd)
		this.debug = options.debug || false
	}

	/**
	 * Check if hooks are enabled
	 */
	async isEnabled(): Promise<boolean> {
		return this.configLoader.hasHooks()
	}

	/**
	 * Set the transcript path (may be set after initialization)
	 */
	setTranscriptPath(path: string): void {
		this.transformer.setTranscriptPath(path)
	}

	/**
	 * Execute PreToolUse hooks
	 */
	async executePreToolUseHooks(toolBlock: ToolUse): Promise<AggregatedHookResult | null> {
		const event = this.transformer.createPreToolUseEvent(toolBlock)
		return this.executeHooksForEvent("PreToolUse", event)
	}

	/**
	 * Execute PostToolUse hooks
	 */
	async executePostToolUseHooks(toolBlock: ToolUse, toolResponse: unknown): Promise<AggregatedHookResult | null> {
		const event = this.transformer.createPostToolUseEvent(toolBlock, toolResponse)
		return this.executeHooksForEvent("PostToolUse", event)
	}

	/**
	 * Execute UserPromptSubmit hooks
	 */
	async executeUserPromptSubmitHooks(prompt: string): Promise<AggregatedHookResult | null> {
		const event = this.transformer.createUserPromptSubmitEvent(prompt)
		return this.executeHooksForEvent("UserPromptSubmit", event)
	}

	/**
	 * Execute Notification hooks
	 */
	async executeNotificationHooks(message: string): Promise<AggregatedHookResult | null> {
		const event = this.transformer.createNotificationEvent(message)
		return this.executeHooksForEvent("Notification", event)
	}

	/**
	 * Execute Stop hooks
	 */
	async executeStopHooks(stopHookActive: boolean = false): Promise<AggregatedHookResult | null> {
		const event = this.transformer.createStopEvent(stopHookActive)
		return this.executeHooksForEvent("Stop", event)
	}

	/**
	 * Execute SubagentStop hooks
	 */
	async executeSubagentStopHooks(stopHookActive: boolean = false): Promise<AggregatedHookResult | null> {
		const event = this.transformer.createSubagentStopEvent(stopHookActive)
		return this.executeHooksForEvent("SubagentStop", event)
	}

	/**
	 * Execute PreCompact hooks
	 */
	async executePreCompactHooks(trigger: "manual" | "auto", customInstructions?: string): Promise<AggregatedHookResult | null> {
		const event = this.transformer.createPreCompactEvent(trigger, customInstructions)
		return this.executeHooksForEvent("PreCompact", event)
	}

	/**
	 * Execute SessionStart hooks
	 */
	async executeSessionStartHooks(source: "startup" | "resume" | "clear"): Promise<AggregatedHookResult | null> {
		const event = this.transformer.createSessionStartEvent(source)
		return this.executeHooksForEvent("SessionStart", event)
	}

	/**
	 * Execute SessionEnd hooks
	 */
	async executeSessionEndHooks(): Promise<AggregatedHookResult | null> {
		const event = this.transformer.createSessionEndEvent()
		return this.executeHooksForEvent("SessionEnd", event)
	}

	/**
	 * Execute hooks for a specific event
	 */
	private async executeHooksForEvent(eventName: HookEventNameType, event: HookEvent): Promise<AggregatedHookResult | null> {
		try {
			// Load configuration
			const config = await this.configLoader.getConfiguration()

			// Get matching hooks
			const toolName = (event as any).tool_name
			const matchingHooks = getMatchingHooks(config, eventName, toolName)

			if (matchingHooks.length === 0) {
				return null
			}

			this.debugLog(`Executing ${matchingHooks.length} hooks for ${eventName}`, {
				toolName,
				hooks: matchingHooks.map((h) => h.command),
			})

			// Execute hooks based on parallel setting
			const results =
				config.settings?.parallel !== false
					? await this.executor.executeHooksParallel(matchingHooks, event)
					: await this.executor.executeHooksSequential(matchingHooks, event)

			// Aggregate results
			const aggregated = aggregateHookResults(results)

			this.debugLog(`Hook execution completed for ${eventName}`, {
				approve: aggregated.approve,
				messageCount: aggregated.messages.length,
			})

			return aggregated
		} catch (error) {
			this.debugLog(`Error executing hooks for ${eventName}`, error)
			// Return null on error to allow operation to continue
			return null
		}
	}

	/**
	 * Reload configuration (useful for testing or when config changes)
	 */
	async reloadConfiguration(): Promise<void> {
		this.configLoader.clearCache()
		await this.configLoader.getConfiguration()
	}

	/**
	 * Get the current configuration
	 */
	async getConfiguration(): Promise<HookConfiguration> {
		return this.configLoader.getConfiguration()
	}

	/**
	 * Debug logging
	 */
	private debugLog(message: string, data?: any): void {
		if (this.debug) {
			console.log(`[HookManager] ${message}`, data ? data : "")
		}
	}
}
