import { ApiProvider } from "@shared/api"
import type { ClineFileStorage } from "@shared/storage/ClineFileStorage"
import {
	applyTransform,
	GlobalStateAndSettingKeys,
	GlobalStateAndSettings,
	getDefaultValue,
	isAsyncProperty,
	isComputedProperty,
	LocalState,
	LocalStateKeys,
	SecretKeys,
	Secrets,
} from "@shared/storage/state-keys"
import { Logger } from "@/shared/services/Logger"
import { ClineMemento } from "@/shared/storage"
import { readTaskHistoryFromState } from "../disk"
import { StateManager } from "../StateManager"

// ─── File-backed storage readers (used by StateManager) ────────────────────

// The native tool call setting shipped default-off behind a feature flag, and the default was
// later flipped to on. A `false` persisted during the default-off era keeps users on text-based
// tool calling forever, which GPT-5-class models intermittently refuse to run with
// (https://github.com/cline/cline/issues/13138).
const NATIVE_TOOL_CALL_DEFAULT_MIGRATION_KEY = "nativeToolCallEnabledDefaultMigrated"

/**
 * One-time reset of a persisted `nativeToolCallEnabled: false` back to the default (true).
 * The migration marker ensures a deliberate opt-out made after this runs is left intact.
 *
 * Users on the OpenAI-Compatible provider are skipped (without setting the marker): their
 * endpoints are arbitrary gateways where native tool calling can genuinely fail, so a
 * persisted `false` may be a deliberate, still-needed opt-out. If they later switch to a
 * provider served by our own request paths, the migration applies on the next startup.
 */
export async function migrateStaleNativeToolCallSetting(store: ClineMemento): Promise<void> {
	try {
		if (store.get(NATIVE_TOOL_CALL_DEFAULT_MIGRATION_KEY) === true) {
			return
		}
		if (store.get("nativeToolCallEnabled") !== false) {
			// Nothing to reset — mark done so any later opt-out is treated as deliberate.
			await store.update(NATIVE_TOOL_CALL_DEFAULT_MIGRATION_KEY, true)
			return
		}
		const providers = [store.get("planModeApiProvider"), store.get("actModeApiProvider")]
		if (providers.includes("openai")) {
			return
		}
		await store.update("nativeToolCallEnabled", true)
		await store.update(NATIVE_TOOL_CALL_DEFAULT_MIGRATION_KEY, true)
		Logger.log("[Storage Migration] Reset stale nativeToolCallEnabled=false to the default (true)")
	} catch (error) {
		Logger.error("[Storage Migration] Failed to migrate nativeToolCallEnabled:", error)
	}
}

/**
 * Read secrets from a ClineFileStorage instance.
 */
export function readSecretsFromStorage(store: ClineFileStorage<string>): Secrets {
	return SecretKeys.reduce((acc, key) => {
		acc[key] = store.get(key)
		return acc
	}, {} as Secrets)
}

/**
 * Read workspace state from a ClineFileStorage instance.
 */
export function readWorkspaceStateFromStorage(store: ClineFileStorage): LocalState {
	return LocalStateKeys.reduce((acc, key) => {
		acc[key] = store.get(key) || {}
		return acc
	}, {} as LocalState)
}

/**
 * Read global state from a ClineFileStorage instance.
 */
export async function readGlobalStateFromStorage(store: ClineMemento): Promise<GlobalStateAndSettings> {
	try {
		// Batch read all state values in a single optimized pass
		const stateValues = new Map<string, any>()
		for (const key of GlobalStateAndSettingKeys) {
			const value = store.get(key as string)
			stateValues.set(key, value)
		}

		const result = {} as any

		for (const key of GlobalStateAndSettingKeys) {
			const stateKey = key as keyof GlobalStateAndSettings
			let value = stateValues.get(stateKey)

			if (isAsyncProperty(stateKey)) {
				continue
			}
			if (isComputedProperty(stateKey)) {
				continue
			}
			if (value === undefined) {
				const defaultValue = getDefaultValue(stateKey)
				if (defaultValue !== undefined) {
					value = defaultValue
				}
			}
			if (value !== undefined) {
				value = applyTransform(stateKey, value)
			}
			result[stateKey] = value
		}

		await handleComputedProperties(result, stateValues)
		await handleAsyncProperties(result)

		return result as GlobalStateAndSettings
	} catch (error) {
		Logger.error("[StateHelpers] Failed to read global state from storage:", error)
		throw error
	}
}

// ─── Legacy readers (for VSCode migration — reads from ExtensionContext) ────

/**
 * Handle properties that require computed logic
 */
async function handleComputedProperties(result: any, stateValues: Map<string, any>): Promise<void> {
	// 1. API Provider logic - set defaults based on existing values
	const defaultApiProvider: ApiProvider = "openrouter"
	result.planModeApiProvider = result.planModeApiProvider || defaultApiProvider
	result.actModeApiProvider = result.actModeApiProvider || defaultApiProvider

	// 2. Plan/Act separate models setting with special logic
	const planActSeparateModelsSettingRaw = stateValues.get("planActSeparateModelsSetting")
	if (planActSeparateModelsSettingRaw === true || planActSeparateModelsSettingRaw === false) {
		result.planActSeparateModelsSetting = planActSeparateModelsSettingRaw
	} else {
		// Default to false when not explicitly set
		result.planActSeparateModelsSetting = false
	}
}

/**
 * Handle properties that require async operations
 */
async function handleAsyncProperties(result: any): Promise<void> {
	// Task history requires async disk read
	result.taskHistory = await readTaskHistoryFromState()
}

export async function resetWorkspaceState() {
	const stateManager = StateManager.get()
	LocalStateKeys.map((key) => stateManager.setWorkspaceState(key, {}))
	await stateManager.reInitialize()
}

export async function resetGlobalState() {
	// TODO: Reset all workspace states?
	const stateManager = StateManager.get()
	GlobalStateAndSettingKeys.map((key) => stateManager.setGlobalState(key, undefined))
	SecretKeys.map((key) => stateManager.setSecret(key, undefined))
	await stateManager.reInitialize()
}
