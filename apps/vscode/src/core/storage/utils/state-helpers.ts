import type { BedrockCoderFileStorage } from "@shared/storage/BedrockCoderFileStorage"
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
import { BedrockCoderMemento } from "@/shared/storage"
import { StateManager } from "../StateManager"

// ─── File-backed storage readers (used by StateManager) ────────────────────

/**
 * Read secrets from a BedrockCoderFileStorage instance.
 */
export function readSecretsFromStorage(store: BedrockCoderFileStorage<string>): Secrets {
	return SecretKeys.reduce((acc, key) => {
		acc[key] = store.get(key)
		return acc
	}, {} as Secrets)
}

/**
 * Read workspace state from a BedrockCoderFileStorage instance.
 */
export function readWorkspaceStateFromStorage(store: BedrockCoderFileStorage): LocalState {
	return LocalStateKeys.reduce((acc, key) => {
		acc[key] = store.get(key) || {}
		return acc
	}, {} as LocalState)
}

/**
 * Read global state from a BedrockCoderFileStorage instance.
 */
export async function readGlobalStateFromStorage(store: BedrockCoderMemento): Promise<GlobalStateAndSettings> {
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
	// 2. Plan/Act separate models setting with special logic
	const planActSeparateModelsSettingRaw = stateValues.get("planActSeparateModelsSetting")
	if (planActSeparateModelsSettingRaw === true || planActSeparateModelsSettingRaw === false) {
		result.planActSeparateModelsSetting = planActSeparateModelsSettingRaw
	} else {
		// Default to false when not explicitly set
		result.planActSeparateModelsSetting = false
	}
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
