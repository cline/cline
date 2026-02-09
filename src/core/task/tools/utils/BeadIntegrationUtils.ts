/**
 * BeadIntegrationUtils - Helper utilities for integrating BeadManager with tool handlers.
 *
 * These utilities provide a safe, optional way for tool handlers to record
 * file changes, token usage, and errors when operating in bead mode.
 */

import type { BeadFileChange } from "@shared/beads"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * Record a file change in the current bead (if bead mode is active).
 * This is a no-op if bead mode is not active.
 */
export function recordFileChange(config: TaskConfig, change: BeadFileChange): void {
	if (config.callbacks.recordBeadFileChange) {
		config.callbacks.recordBeadFileChange(change)
	}
}

/**
 * Record a file creation in the current bead.
 */
export function recordFileCreated(config: TaskConfig, filePath: string, linesAdded?: number): void {
	recordFileChange(config, {
		filePath,
		changeType: "created",
		linesAdded,
	})
}

/**
 * Record a file modification in the current bead.
 */
export function recordFileModified(
	config: TaskConfig,
	filePath: string,
	options?: {
		diff?: string
		linesAdded?: number
		linesRemoved?: number
	},
): void {
	recordFileChange(config, {
		filePath,
		changeType: "modified",
		diff: options?.diff,
		linesAdded: options?.linesAdded,
		linesRemoved: options?.linesRemoved,
	})
}

/**
 * Record a file deletion in the current bead.
 */
export function recordFileDeleted(config: TaskConfig, filePath: string, linesRemoved?: number): void {
	recordFileChange(config, {
		filePath,
		changeType: "deleted",
		linesRemoved,
	})
}

/**
 * Record token usage in the current bead (if bead mode is active).
 * This is a no-op if bead mode is not active.
 */
export function recordTokenUsage(config: TaskConfig, tokens: number): void {
	if (config.callbacks.recordBeadTokenUsage) {
		config.callbacks.recordBeadTokenUsage(tokens)
	}
}

/**
 * Record an error in the current bead (if bead mode is active).
 * This is a no-op if bead mode is not active.
 */
export function recordError(config: TaskConfig, error: string): void {
	if (config.callbacks.recordBeadError) {
		config.callbacks.recordBeadError(error)
	}
}

/**
 * Check if bead mode is active for this task.
 */
export function isBeadModeActive(config: TaskConfig): boolean {
	return config.services.beadManager !== undefined
}

/**
 * Get the current bead number (returns 0 if bead mode is not active).
 */
export function getCurrentBeadNumber(config: TaskConfig): number {
	return config.services.beadManager?.getState().currentBeadNumber ?? 0
}
