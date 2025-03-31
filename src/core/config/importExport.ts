import os from "os"
import * as path from "path"
import fs from "fs/promises"

import * as vscode from "vscode"
import { z } from "zod"

import { globalSettingsSchema } from "../../schemas"
import { ProviderSettingsManager, providerProfilesSchema } from "./ProviderSettingsManager"
import { ContextProxy } from "./ContextProxy"

type ImportExportOptions = {
	providerSettingsManager: ProviderSettingsManager
	contextProxy: ContextProxy
}

export const importSettings = async ({ providerSettingsManager, contextProxy }: ImportExportOptions) => {
	const uris = await vscode.window.showOpenDialog({
		filters: { JSON: ["json"] },
		canSelectMany: false,
	})

	if (!uris) {
		return { success: false }
	}

	const schema = z.object({
		providerProfiles: providerProfilesSchema,
		globalSettings: globalSettingsSchema,
	})

	try {
		const previousProviderProfiles = await providerSettingsManager.export()

		const { providerProfiles: newProviderProfiles, globalSettings } = schema.parse(
			JSON.parse(await fs.readFile(uris[0].fsPath, "utf-8")),
		)

		const providerProfiles = {
			currentApiConfigName: newProviderProfiles.currentApiConfigName,
			apiConfigs: {
				...previousProviderProfiles.apiConfigs,
				...newProviderProfiles.apiConfigs,
			},
			modeApiConfigs: {
				...previousProviderProfiles.modeApiConfigs,
				...newProviderProfiles.modeApiConfigs,
			},
		}

		await providerSettingsManager.import(newProviderProfiles)

		await contextProxy.setValues(globalSettings)
		contextProxy.setValue("currentApiConfigName", providerProfiles.currentApiConfigName)
		contextProxy.setValue("listApiConfigMeta", await providerSettingsManager.listConfig())

		return { providerProfiles, globalSettings, success: true }
	} catch (e) {
		return { success: false }
	}
}

export const exportSettings = async ({ providerSettingsManager, contextProxy }: ImportExportOptions) => {
	const uri = await vscode.window.showSaveDialog({
		filters: { JSON: ["json"] },
		defaultUri: vscode.Uri.file(path.join(os.homedir(), "Documents", "roo-code-settings.json")),
	})

	if (!uri) {
		return
	}

	try {
		const providerProfiles = await providerSettingsManager.export()
		const globalSettings = await contextProxy.export()

		const dirname = path.dirname(uri.fsPath)
		await fs.mkdir(dirname, { recursive: true })
		await fs.writeFile(uri.fsPath, JSON.stringify({ providerProfiles, globalSettings }, null, 2), "utf-8")
	} catch (e) {}
}
