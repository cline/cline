import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { prepareRemoteConfigCoreIntegration } from "@cline/core"
import { Controller } from "@/sdk/SdkController"
import { Logger } from "@/shared/services/Logger"
import type { ConfiguredAPIKeys } from "@/shared/storage/state-keys"
import { SdkRemoteConfigControlPlane } from "./sdk-control-plane"
import { applyRemoteConfig, clearRemoteConfig } from "./utils"

export interface RefreshSdkRemoteConfigOptions {
	workspacePath?: string
	rootPath?: string
}

async function ensureGlobalRemoteConfigWorkspacePath(): Promise<string> {
	const clineDir = process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
	const workspacePath = path.join(clineDir, "data", "remote-config-workspace")
	await fs.mkdir(workspacePath, { recursive: true })
	return workspacePath
}

async function getRemoteConfigWorkspacePath(workspacePath?: string): Promise<string> {
	const trimmed = workspacePath?.trim()
	if (trimmed) {
		return trimmed
	}
	return ensureGlobalRemoteConfigWorkspacePath()
}

export async function refreshSdkRemoteConfig(controller: Controller, options: RefreshSdkRemoteConfigOptions = {}): Promise<void> {
	const controlPlane = new SdkRemoteConfigControlPlane(controller)
	const workspacePath = await getRemoteConfigWorkspacePath(options.workspacePath)

	try {
		const integration = await prepareRemoteConfigCoreIntegration({
			workspacePath,
			rootPath: options.rootPath,
			controlPlane,
			useCachedBundle: false,
		})

		const remoteConfig = controlPlane.getLastRemoteConfig()
		if (!remoteConfig) {
			clearRemoteConfig()
			await controller.setRemoteConfigCoreIntegration(undefined)
			await controller.postStateToWebview()
			return
		}

		await controller.setRemoteConfigCoreIntegration(integration)

		try {
			const configuredKeys: ConfiguredAPIKeys = controlPlane.getLastConfiguredKeys()
			await applyRemoteConfig(remoteConfig, configuredKeys, controller.mcpHub)
		} catch (bridgeError) {
			Logger.error("[RemoteConfig] SDK refresh succeeded but classic bridge application failed:", bridgeError)
		}

		await controller.postStateToWebview()
	} catch (error) {
		if (controlPlane.wasExplicitNoConfig()) {
			clearRemoteConfig()
			await controller.setRemoteConfigCoreIntegration(undefined)
			await controller.postStateToWebview()
			return
		}
		Logger.error("[RemoteConfig] Failed to refresh SDK remote config; keeping previous config:", error)
	}
}
