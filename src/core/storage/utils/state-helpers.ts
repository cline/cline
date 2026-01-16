import { ApiProvider } from "@shared/api"
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
import { ExtensionContext } from "vscode"
import { Controller } from "@/core/controller"
import { ClineRulesToggles } from "@/shared/cline-rules"
import { readTaskHistoryFromState } from "../disk"

export async function readSecretsFromDisk(context: ExtensionContext): Promise<Secrets> {
	const secrets = await Promise.all(SecretKeys.map((key) => context.secrets.get(key)))

	return SecretKeys.reduce((acc, key, index) => {
		acc[key] = secrets[index]
		return acc
	}, {} as Secrets)
}

export async function readWorkspaceStateFromDisk(context: ExtensionContext): Promise<LocalState> {
	const states = LocalStateKeys.map((key) => context.workspaceState.get<ClineRulesToggles | undefined>(key))

	return LocalStateKeys.reduce((acc, key, index) => {
		acc[key] = states[index] || {}
		return acc
	}, {} as LocalState)
}

export async function readGlobalStateFromDisk(context: ExtensionContext): Promise<GlobalStateAndSettings> {
	try {
		// Batch read all state values in a single optimized pass
		const stateValues = new Map<string, any>()
		// Read all values at once for better performance
		for (const key of GlobalStateAndSettingKeys) {
			const value = context.globalState.get(key as string)
			stateValues.set(key, value)
		}

		// Build result object with proper typing
		const result = {} as any // Use any for assignment, but return proper type

		// Process each state property using optimized approach
		for (const key of GlobalStateAndSettingKeys) {
			const stateKey = key as keyof GlobalStateAndSettings
			let value = stateValues.get(stateKey)

			// Skip async properties - they need special handling
			if (isAsyncProperty(stateKey)) {
				continue
			}

			// Skip computed properties - they need special handling
			if (isComputedProperty(stateKey)) {
				continue
			}

			// Apply default value if needed
			if (value === undefined) {
				const defaultValue = getDefaultValue(stateKey)
				if (defaultValue !== undefined) {
					value = defaultValue
				}
			}

			// Apply transformation if provided
			if (value !== undefined) {
				value = applyTransform(stateKey, value)
			}
			// Set the processed value
			result[stateKey] = value
		}

		// Handle computed properties with special logic
		await handleComputedProperties(result, stateValues)

		// Handle async properties
		await handleAsyncProperties(result)

		return result as GlobalStateAndSettings
	} catch (error) {
		console.error("[StateHelpers] Failed to read global state:", error)
		throw error
	}
}

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

export async function resetWorkspaceState(controller: Controller) {
	await Promise.all(LocalStateKeys.map((key) => controller.context.workspaceState.update(key, undefined)))

	await controller.stateManager.reInitialize()
}

export async function resetGlobalState(controller: Controller) {
	// TODO: Reset all workspace states?
	const context = controller.context

	await Promise.all(GlobalStateAndSettingKeys.map((key) => context.globalState.update(key, undefined)))

	await Promise.all(SecretKeys.map((key) => context.secrets.delete(key)))

	await controller.stateManager.reInitialize()
}
