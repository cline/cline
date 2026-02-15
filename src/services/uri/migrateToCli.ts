/**
 * Exports VS Code extension secrets and settings to the CLI's storage directory (~/.cline/data/)
 * so the CLI can import them during onboarding without the user re-authenticating.
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"
import { GlobalStateAndSettingKeys, SecretKeys } from "@/shared/storage/state-keys"

const CLI_DATA_DIR = path.join(os.homedir(), ".cline", "data")

export async function migrateToCli(): Promise<boolean> {
	try {
		const stateManager = StateManager.get()

		// Read all secrets from StateManager cache
		const secrets: Record<string, string> = {}
		for (const key of SecretKeys) {
			const value = stateManager.getSecretKey(key)
			if (value) {
				secrets[key] = value
			}
		}

		// Read all globalState settings from StateManager cache
		const globalState: Record<string, any> = {}
		for (const key of GlobalStateAndSettingKeys) {
			const value = stateManager.getGlobalStateKey(key as any)
			if (value !== undefined) {
				globalState[key] = value
			}
		}

		// Ensure directory exists
		fs.mkdirSync(CLI_DATA_DIR, { recursive: true })

		// Write secrets with restricted permissions (owner read/write only)
		const secretsPath = path.join(CLI_DATA_DIR, "secrets.json")
		fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 })

		// Write globalState with restricted permissions
		const globalStatePath = path.join(CLI_DATA_DIR, "globalState.json")
		fs.writeFileSync(globalStatePath, JSON.stringify(globalState, null, 2), { mode: 0o600 })

		Logger.info(
			`[migrateToCli] Exported ${Object.keys(secrets).length} secrets and ${Object.keys(globalState).length} settings to ${CLI_DATA_DIR}`,
		)

		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Cline CLI setup complete. You can return to your terminal.",
		})

		return true
	} catch (error) {
		Logger.error("[migrateToCli] Failed to export state for CLI:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to export settings to Cline CLI. Check the output log for details.",
		})
		return false
	}
}
