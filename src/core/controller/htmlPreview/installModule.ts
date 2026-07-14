import type { InstallModuleRequest, InstallModuleResponse } from "@shared/proto/cline/html_preview"
import { InstallModuleResponse as InstallModuleResponseProto } from "@shared/proto/cline/html_preview"
import axios from "axios"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"
import type { Controller } from "../index"
import { assertTrustedMarketplaceUrl } from "./marketplaceUrlAllowlist"

export async function installModule(controller: Controller, request: InstallModuleRequest): Promise<InstallModuleResponse> {
	const { moduleId, downloadUrl, title } = request
	try {
		assertTrustedMarketplaceUrl(downloadUrl, "installModule downloadUrl")
		const modulesDir = path.join(os.homedir(), ".aihydro", "modules", moduleId)
		await fs.mkdir(modulesDir, { recursive: true })
		const localPath = path.join(modulesDir, "module.html")

		const response = await axios.get(downloadUrl, { responseType: "text", timeout: 30000 })
		await fs.writeFile(localPath, response.data, "utf-8")

		// Register in installed.json
		const registryPath = path.join(os.homedir(), ".aihydro", "modules", "installed.json")
		let registry: Record<string, { id: string; title: string; localPath: string; installedAt: string }> = {}
		try {
			registry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
		} catch {
			// registry doesn't exist yet — start fresh
		}
		registry[moduleId] = { id: moduleId, title, localPath, installedAt: new Date().toISOString() }
		await fs.writeFile(registryPath, JSON.stringify(registry, null, 2))

		// Open in preview
		const { PreviewHtmlRequest } = await import("@shared/proto/cline/html_preview")
		const { previewHtml } = await import("@core/controller/htmlPreview/previewHtml")
		await previewHtml(controller, PreviewHtmlRequest.create({ htmlContent: "", title, filePath: localPath }))
		void MarketplaceRecognitionService.recordEvent({
			marketplace: "modules",
			itemId: moduleId,
			eventType: "install",
			source: "ui",
		})

		return InstallModuleResponseProto.create({ moduleId, localPath, success: true })
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Install failed"
		return InstallModuleResponseProto.create({ moduleId, localPath: "", success: false, error: msg })
	}
}
