import { featureFlagsService } from "@/services/feature-flags"
import type { StateManager } from "../storage/StateManager"

/**
 * Determines if multi-root workspace mode should be enabled.
 *
 * Multi-root is enabled only when BOTH conditions are true:
 * 1. The feature flag is enabled (server-side control)
 * 2. The user has opted in via their settings (user preference)
 *
 * @param stateManager - The state manager to check user preferences
 * @returns true if both feature flag and user setting are enabled
 */
export function isMultiRootEnabled(stateManager: StateManager): boolean {
	const featureFlag = featureFlagsService.getMultiRootEnabled()
	const userSetting = stateManager.getGlobalStateKey("multiRootEnabled")
	return featureFlag && !!userSetting
}
