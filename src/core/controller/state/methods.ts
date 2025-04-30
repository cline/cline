import { registerMethod } from "./index"
import { getLatestState } from "./getLatestState"

/**
 * Register all state service methods
 */
export function registerAllMethods(): void {
	// Register each method with the registry
	registerMethod("getLatestState", getLatestState)
}
