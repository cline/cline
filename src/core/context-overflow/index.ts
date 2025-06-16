import { Task } from "../task/Task"
import { getModeBySlug } from "../../shared/modes"
import type { ModeConfig } from "@roo-code/types"

/**
 * Default context overflow message when none is specified
 */
const DEFAULT_OVERFLOW_MESSAGE =
	"Task failed because of a context overflow, possibly because webpage returned from the browser was too big"

/**
 * Default tools that commonly cause context overflow
 */
const DEFAULT_TRIGGER_TOOLS = ["browser_action", "read_file", "search_files", "list_files"]

/**
 * Check if context overflow contingency should be triggered for a mode
 */
export function shouldTriggerContextOverflowContingency(
	modeSlug: string,
	customModes?: ModeConfig[],
	lastToolUsed?: string,
	globalSettings?: {
		contextOverflowContingencyEnabled?: boolean
		contextOverflowContingencyTriggerTools?: string[]
	},
): boolean {
	// Check global setting first
	if (globalSettings?.contextOverflowContingencyEnabled) {
		const triggerTools = globalSettings.contextOverflowContingencyTriggerTools || DEFAULT_TRIGGER_TOOLS
		return !lastToolUsed || triggerTools.includes(lastToolUsed)
	}

	// Check mode-specific setting
	const mode = getModeBySlug(modeSlug, customModes)
	if (mode?.contextOverflowContingency?.enabled) {
		const triggerTools = mode.contextOverflowContingency.triggerTools || DEFAULT_TRIGGER_TOOLS
		return !lastToolUsed || triggerTools.includes(lastToolUsed)
	}

	return false
}

/**
 * Get the context overflow message for a mode
 */
export function getContextOverflowMessage(
	modeSlug: string,
	customModes?: ModeConfig[],
	globalSettings?: {
		contextOverflowContingencyMessage?: string
	},
): string {
	// Check global setting first
	if (globalSettings?.contextOverflowContingencyMessage) {
		return globalSettings.contextOverflowContingencyMessage
	}

	// Check mode-specific setting
	const mode = getModeBySlug(modeSlug, customModes)
	if (mode?.contextOverflowContingency?.message) {
		return mode.contextOverflowContingency.message
	}

	return DEFAULT_OVERFLOW_MESSAGE
}

/**
 * Get the last tool used from the assistant message content
 */
export function getLastToolUsed(cline: Task): string | undefined {
	// Look through the assistant message content to find the last tool use
	const lastToolBlock = cline.assistantMessageContent
		.slice()
		.reverse()
		.find((block) => block.type === "tool_use")

	return lastToolBlock?.name
}

/**
 * Trigger context overflow contingency for a subtask
 */
export async function triggerContextOverflowContingency(cline: Task, lastToolUsed?: string): Promise<void> {
	const provider = cline.providerRef.deref()
	if (!provider) {
		return
	}

	const state = await provider.getState()
	const { mode, customModes } = state

	// If no tool was provided, try to detect it from the task
	const toolUsed = lastToolUsed || getLastToolUsed(cline)

	if (
		!shouldTriggerContextOverflowContingency(mode, customModes, toolUsed, {
			// Note: These properties don't exist yet in the state type, but will be added
			contextOverflowContingencyEnabled: (state as any).contextOverflowContingencyEnabled,
			contextOverflowContingencyTriggerTools: (state as any).contextOverflowContingencyTriggerTools,
		})
	) {
		return
	}

	const message = getContextOverflowMessage(mode, customModes, {
		contextOverflowContingencyMessage: (state as any).contextOverflowContingencyMessage,
	})

	// Log the context overflow event
	provider.log(
		`[context-overflow] Context overflow contingency triggered for mode '${mode}' after tool '${toolUsed || "unknown"}'`,
	)

	// If this is a subtask, finish it with the overflow message
	if (cline.parentTask) {
		await provider.finishSubTask(message)
	} else {
		// For main tasks, just add an error message
		await cline.say("error", message)
	}
}
