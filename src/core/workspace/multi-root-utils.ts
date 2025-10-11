import { featureFlagsService } from "@/services/feature-flags"
import type { StateManager } from "../storage/StateManager"

/**
 * Determines if multi-root workspace mode should be enabled.
 *
 * Multi-root is enabled when:
 * 1. Running in standalone/CLI mode (always enabled for CLI usage), OR
 * 2. Both the feature flag AND user setting are enabled (for VSCode extension)
 *
 * @param stateManager - The state manager to check user preferences
 * @param forceEnable - Optional flag to force enable (used when CLI provides workspace paths)
 * @returns true if multi-root should be enabled
 */
export function isMultiRootEnabled(stateManager: StateManager, forceEnable?: boolean): boolean {
	// If explicitly forced (e.g., CLI provided workspace paths), always enable
	if (forceEnable) {
		return true
	}

	// Check if running in standalone mode (CLI)
	// In standalone mode, we always enable multi-root since the CLI explicitly provides workspace paths
	console.log(" DEBUG: isMultiRootEnabled: isStandalone:", (global as any).standaloneTerminalManager)
	const isStandalone = typeof (global as any).standaloneTerminalManager !== "undefined"
	console.log(" DEBUG: isMultiRootEnabled: isStandalone", isStandalone)
	if (isStandalone) {
		return true
	}

	// For VSCode extension, require both feature flag and user setting
	const featureFlag = featureFlagsService.getMultiRootEnabled()
	const userSetting = stateManager.getGlobalStateKey("multiRootEnabled")
	return featureFlag && !userSetting
}
