import type { Mode } from "@shared/storage/types"

export function getModeChange(currentMode: Mode, requestedMode: Mode): Mode | undefined {
	return currentMode === requestedMode ? undefined : requestedMode
}
