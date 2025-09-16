/**
 * Hook Configuration Types
 * Defines the configuration structure for hooks
 * Compatible with Claude's hooks.json format
 */

import { HookEventNameType } from "./HookEvent"

/**
 * Individual hook definition
 */
export interface HookDefinition {
	/**
	 * Type of hook (currently only "command" is supported)
	 */
	type: "command"

	/**
	 * Command to execute
	 * Can be a string or array of strings (command + args)
	 */
	command: string | string[]

	/**
	 * Timeout in seconds (default: 60)
	 */
	timeout?: number

	/**
	 * Environment variables to pass to the hook
	 */
	environment?: Record<string, string>
}

/**
 * Hook matcher configuration
 */
export interface HookMatcher {
	/**
	 * Pattern to match against tool names
	 * - "*" matches all tools
	 * - "toolName" matches exact tool name
	 * - "tool1|tool2" matches multiple tools
	 * - Can use glob patterns like "write_*"
	 */
	matcher: string

	/**
	 * List of hooks to execute when matcher matches
	 */
	hooks: HookDefinition[]
}

/**
 * Complete hook configuration
 * This matches Claude's hooks.json structure
 */
export interface HookConfiguration {
	/**
	 * Hooks organized by event type
	 */
	hooks: {
		[K in HookEventNameType]?: HookMatcher[]
	}

	/**
	 * Optional global settings
	 */
	settings?: {
		/**
		 * Default timeout for all hooks in seconds
		 */
		defaultTimeout?: number

		/**
		 * Whether to run hooks in parallel
		 */
		parallel?: boolean

		/**
		 * Debug mode - logs hook executions
		 */
		debug?: boolean
	}
}

/**
 * Default hook configuration
 */
export const DEFAULT_HOOK_CONFIG: HookConfiguration = {
	hooks: {},
	settings: {
		defaultTimeout: 60,
		parallel: true,
		debug: false,
	},
}

/**
 * Check if a tool name matches a pattern
 */
export function matchesPattern(toolName: string, pattern: string): boolean {
	// Exact match or wildcard
	if (pattern === "*" || pattern === toolName) {
		return true
	}

	// Multiple tools separated by |
	if (pattern.includes("|")) {
		const tools = pattern.split("|").map((t) => t.trim())
		return tools.includes(toolName)
	}

	// Glob pattern support
	if (pattern.includes("*")) {
		const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
		return regex.test(toolName)
	}

	return false
}

/**
 * Get matching hooks for a tool and event
 */
export function getMatchingHooks(config: HookConfiguration, eventName: HookEventNameType, toolName?: string): HookDefinition[] {
	const eventHooks = config.hooks[eventName]
	if (!eventHooks) {
		return []
	}

	const matchingHooks: HookDefinition[] = []

	for (const matcher of eventHooks) {
		// For non-tool events, matcher is usually "*"
		// For tool events, check if tool matches pattern
		if (!toolName || matchesPattern(toolName, matcher.matcher)) {
			matchingHooks.push(...matcher.hooks)
		}
	}

	return matchingHooks
}

/**
 * Validate hook configuration
 */
export function validateHookConfiguration(config: unknown): config is HookConfiguration {
	if (!config || typeof config !== "object") {
		return false
	}

	const cfg = config as any
	if (!cfg.hooks || typeof cfg.hooks !== "object") {
		return false
	}

	// Validate each event type's hooks
	for (const eventHooks of Object.values(cfg.hooks)) {
		if (!Array.isArray(eventHooks)) {
			return false
		}

		for (const matcher of eventHooks as any[]) {
			if (!matcher.matcher || typeof matcher.matcher !== "string") {
				return false
			}
			if (!Array.isArray(matcher.hooks)) {
				return false
			}

			for (const hook of matcher.hooks) {
				if (hook.type !== "command") {
					return false
				}
				if (!hook.command) {
					return false
				}
			}
		}
	}

	return true
}
