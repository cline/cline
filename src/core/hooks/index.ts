/**
 * Cline Hook System
 * Main exports for the hook system
 */

export { EventTransformer } from "./EventTransformer"
export { HookConfigurationLoader } from "./HookConfiguration"
export { HookExecutor } from "./HookExecutor"
export type { HookManagerOptions } from "./HookManager"
export { HookManager } from "./HookManager"
export type { HookResponseHandlerContext } from "./handlers/HookResponseHandler"
export { HookResponseHandler } from "./handlers/HookResponseHandler"
export type {
	HookConfiguration,
	HookDefinition,
	HookMatcher,
} from "./types/HookConfiguration"
export {
	DEFAULT_HOOK_CONFIG,
	getMatchingHooks,
	matchesPattern,
	validateHookConfiguration,
} from "./types/HookConfiguration"
// Type exports
export type {
	HookEvent,
	HookEventNameType,
	NotificationEvent,
	PostToolUseEvent,
	PreCompactEvent,
	PreToolUseEvent,
	SessionEndEvent,
	SessionStartEvent,
	StopEvent,
	SubagentStopEvent,
	UserPromptSubmitEvent,
} from "./types/HookEvent"
export { getClineToolName, TOOL_NAME_MAP } from "./types/HookEvent"
export type {
	AggregatedHookResult,
	HookExecutionResult,
	HookResponse,
} from "./types/HookResponse"
export {
	aggregateHookResults,
	createDenyResponse,
	DEFAULT_APPROVE_RESPONSE,
	parseHookOutput,
} from "./types/HookResponse"
