import * as vscode from "vscode"
import { storeSecret, updateGlobalState } from "../../core/storage/state"
import { GlobalStateKey, SecretKey } from "../../core/storage/state-keys" // Import the actual types

// --- Functions to Apply Overrides on Startup ---

/**
 * Reads 'cline.overwriteState' from VS Code settings and applies it
 * to the extension's internal global state storage on startup.
 */
export async function applyStateOverwriteOnStartup(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration("cline")
	const overwriteState = config.get<Record<string, any>>("overwriteState")

	if (overwriteState && typeof overwriteState === "object") {
		console.log("[Letsboot Fork] Applying initial state overwrites from settings.json...")
		for (const key in overwriteState) {
			// Assume keys in overwriteState are valid GlobalStateKeys based on config structure
			if (Object.prototype.hasOwnProperty.call(overwriteState, key)) {
				try {
					// Type assertion helps satisfy the storage function signature
					await updateGlobalState(context, key as GlobalStateKey, overwriteState[key])
				} catch (error) {
					console.error(`[Letsboot Fork] Error applying initial state overwrite for key "${key}":`, error)
				}
			}
		}
	}
}

/**
 * Reads 'cline.overwriteSecrets' from VS Code settings and applies it
 * to the extension's internal secret storage on startup.
 */
export async function applySecretOverwriteOnStartup(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration("cline")
	const overwriteSecrets = config.get<Record<string, any>>("overwriteSecrets")

	if (overwriteSecrets && typeof overwriteSecrets === "object") {
		console.log("[Letsboot Fork] Applying initial secret overwrites from settings.json...")
		for (const key in overwriteSecrets) {
			// Assume keys in overwriteSecrets are valid SecretKeys based on config structure
			if (Object.prototype.hasOwnProperty.call(overwriteSecrets, key)) {
				try {
					// Type assertion helps satisfy the storage function signature
					await storeSecret(context, key as SecretKey, overwriteSecrets[key])
				} catch (error) {
					console.error(`[Letsboot Fork] Error applying initial secret overwrite for key "${key}":`, error)
				}
			}
		}
	}
}

// --- Functions to Update settings.json from UI changes ---

/**
 * Updates a specific key within the 'cline.overwriteState' object in settings.json
 * and also updates the internal extension state.
 */
export async function updateOverwrittenState(context: vscode.ExtensionContext, key: GlobalStateKey, value: any): Promise<void> {
	const config = vscode.workspace.getConfiguration("cline")
	const currentOverwriteState = config.get<Record<string, any>>("overwriteState") || {}

	// First, always update internal state for immediate reflection in UI
	try {
		await context.globalState.update(key, value)
		console.log(`[Letsboot Fork] Updated internal state for ${key}.`)
	} catch (stateError) {
		console.error(`[Letsboot Fork] Failed to update internal state for ${key}:`, stateError)
		vscode.window.showErrorMessage(`[Letsboot Fork] Failed to update internal state for "${key}".`)
	}

	// Only update settings.json if this key already exists in overwriteState
	if (Object.prototype.hasOwnProperty.call(currentOverwriteState, key)) {
		try {
			// Create the updated object with only the existing keys
			const newState = { ...currentOverwriteState, [key]: value }

			// Update settings.json
			await config.update("overwriteState", newState, vscode.ConfigurationTarget.Global)
			console.log(`[Letsboot Fork] Updated overwriteState.${key} in settings.json.`)
		} catch (error) {
			console.error(`[Letsboot Fork] Failed to update overwriteState.${key} in settings.json:`, error)
			// Don't show error message to user since internal state was updated successfully
		}
	} else {
		console.log(`[Letsboot Fork] Key ${key} not found in overwriteState, skipping settings.json update.`)
	}
}

/**
 * Updates a specific key within the 'cline.overwriteSecrets' object in settings.json
 * and also updates the internal extension state.
 */
export async function updateOverwrittenSecret(context: vscode.ExtensionContext, key: SecretKey, value: any): Promise<void> {
	const config = vscode.workspace.getConfiguration("cline")
	const currentOverwriteSecrets = config.get<Record<string, any>>("overwriteSecrets") || {}

	// First, always update internal secrets for immediate reflection in UI
	try {
		if (value) {
			await context.secrets.store(key, value)
		} else {
			await context.secrets.delete(key)
		}
		console.log(`[Letsboot Fork] Updated internal secret for ${key}.`)
	} catch (secretError) {
		console.error(`[Letsboot Fork] Failed to update internal secret for ${key}:`, secretError)
		vscode.window.showErrorMessage(`[Letsboot Fork] Failed to update internal secret for "${key}".`)
	}

	// Only update settings.json if this key already exists in overwriteSecrets
	if (Object.prototype.hasOwnProperty.call(currentOverwriteSecrets, key)) {
		try {
			// Create the updated object with only the existing keys
			const newSecrets = { ...currentOverwriteSecrets, [key]: value }

			// Update settings.json
			await config.update("overwriteSecrets", newSecrets, vscode.ConfigurationTarget.Global)
			console.log(`[Letsboot Fork] Updated overwriteSecrets.${key} in settings.json.`)
		} catch (error) {
			console.error(`[Letsboot Fork] Failed to update overwriteSecrets.${key} in settings.json:`, error)
			// Don't show error message to user since internal secret was updated successfully
		}
	} else {
		console.log(`[Letsboot Fork] Key ${key} not found in overwriteSecrets, skipping settings.json update.`)
	}
}
