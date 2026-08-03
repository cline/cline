// Mode configuration migration: flat keys → nested ModeConfigurations (V14 §3.1)
//
// The plan/act mode provider+model settings historically lived as ~90 flat
// global-state keys (planModeApiModelId, actModeOpenRouterModelId,
// geminiPlanModeThinkingLevel, …). V14 converges them into a nested per-mode
// record (`modeConfigurations`) while keeping the flat keys intact (dual-write)
// so:
//
//   - old readers keep working after migration (downgrade-safe),
//   - new readers can switch models per mode in one place,
//   - the migration is idempotent and guarded by a version sentinel.
//
// This module is pure where possible — the only side-effecting entry point is
// `runModeConfigMigration`, which is called once at controller startup.

import { MODE_CONFIGURATION_VERSION, type ModeConfigurations } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"

/** Modes that participate in the flat → nested migration. */
export const MODE_CONFIG_KEYS: readonly Mode[] = ["plan", "act"]

/** Sentinel global-state key storing the migration version. */
export const MODE_CONFIGURATION_VERSION_KEY = "modeConfigurationVersion"

/** Nested global-state key holding the migrated configuration. */
export const MODE_CONFIGURATIONS_KEY = "modeConfigurations"

/**
 * Mode segment variants found inside flat mode keys:
 *   planModeApiModelId          → "planMode"  at index 0
 *   actModeOpenRouterModelId    → "actMode"  at index 0
 *   geminiPlanModeThinkingLevel → "PlanMode" at index 6
 */
const MODE_SEGMENTS: ReadonlyArray<{ mode: Mode; segment: string }> = [
	{ mode: "plan", segment: "planMode" },
	{ mode: "plan", segment: "PlanMode" },
	{ mode: "act", segment: "actMode" },
	{ mode: "act", segment: "ActMode" },
]

/** Case-insensitive lowercase of the mode name (e.g. "PlanMode" → "planmode"). */
function lower(value: string): string {
	return value.toLowerCase()
}

/**
 * Split a flat mode key into `{ mode, rest }` where `rest` is the key with the
 * mode segment removed ("planModeApiModelId" → "apiModelId",
 * "geminiPlanModeThinkingLevel" → "geminiThinkingLevel"). Returns undefined
 * for keys that carry no mode segment.
 */
export function splitModeKey(key: string): { mode: Mode; rest: string } | undefined {
	const normalized = lower(key)
	for (const { mode, segment } of MODE_SEGMENTS) {
		const at = normalized.indexOf(lower(segment))
		if (at >= 0) {
			return { mode, rest: `${key.slice(0, at)}${key.slice(at + segment.length)}` }
		}
	}
	return undefined
}

/**
 * Group the flat settings into a nested ModeConfigurations record.
 * Only keys that are actually defined (non-undefined) participate; keys with
 * undefined values are omitted so the record stays compact.
 */
export function buildModeConfigurations(flatSettings: Record<string, unknown>): ModeConfigurations {
	const result: ModeConfigurations = {}
	for (const [key, value] of Object.entries(flatSettings)) {
		if (value === undefined) {
			continue
		}
		const split = splitModeKey(key)
		if (!split) {
			continue
		}
		const modeConfig = result[split.mode]
		if (modeConfig === undefined) {
			result[split.mode] = {}
		}
		result[split.mode]![split.rest] = value
	}
	return result
}

/**
 * True when at least one flat planMode/actMode mode key (with a star suffix)
 * is present in the given settings — i.e. there is legacy data worth migrating.
 */
export function hasFlatModeKeys(settings: Record<string, unknown>): boolean {
	return Object.keys(settings).some((key) => splitModeKey(key) !== undefined)
}

/**
 * True when the migration still needs to run: the sentinel is absent or stale
 * AND there is legacy flat data to migrate.
 */
export function shouldRunModeConfigMigration(settings: Record<string, unknown>, version: number | undefined): boolean {
	if (typeof version === "number" && version >= MODE_CONFIGURATION_VERSION) {
		return false
	}
	return hasFlatModeKeys(settings)
}

export interface ModeConfigMigrationWriter {
	/** Read the current flat setting for a key. */
	getFlat(key: string): unknown
	/** Write the nested configuration + sentinel. */
	setNested(configurations: ModeConfigurations, version: number): void
}

/**
 * Execute the flat → nested migration. Idempotent and downgrade-safe:
 *
 *   1. builds the nested record from the CURRENT flat keys (flat keys are left
 *      untouched — dual-write),
 *   2. writes the nested record under `modeConfigurations`,
 *   3. bumps `modeConfigurationVersion` to 1 so it never runs again.
 *
 * Returns the nested configuration when a migration happened, undefined when
 * there was nothing to do (already migrated, or no flat keys present).
 */
export function runModeConfigMigration(
	settings: Record<string, unknown>,
	version: number | undefined,
	writer: ModeConfigMigrationWriter,
): ModeConfigurations | undefined {
	if (!shouldRunModeConfigMigration(settings, version)) {
		return undefined
	}
	const configurations = buildModeConfigurations(settings)
	writer.setNested(configurations, MODE_CONFIGURATION_VERSION)
	return configurations
}

/**
 * Convenience accessor: read a normalized setting out of a ModeConfigurations
 * record by its FLAT key name (e.g. getModeConfigValue(configs, "plan",
 * "planModeApiModelId") returns the value that lived under that flat key).
 */
export function getModeConfigValue(configurations: ModeConfigurations | undefined, mode: Mode, flatKey: string): unknown {
	const split = splitModeKey(flatKey)
	if (!split || split.mode !== mode) {
		return undefined
	}
	return configurations?.[mode]?.[split.rest]
}
