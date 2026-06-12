import type { InstallModuleRequest, InstallModuleResponse } from "@shared/proto/cline/html_preview"
import { InstallModuleResponse as InstallModuleResponseProto } from "@shared/proto/cline/html_preview"
import axios from "axios"
import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { ModuleRegistryEntry } from "@/services/htmlPreview/moduleRegistry"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"
import type { Controller } from "../index"

export async function installModule(controller: Controller, request: InstallModuleRequest): Promise<InstallModuleResponse> {
	const { moduleId, downloadUrl, title, version } = request
	try {
		const modulesDir = path.join(os.homedir(), ".aihydro", "modules", moduleId)
		await fs.mkdir(modulesDir, { recursive: true })
		const localPath = path.join(modulesDir, "module.html")

		const response = await axios.get(downloadUrl, { responseType: "text", timeout: 30000 })
		const html = String(response.data)
		await fs.writeFile(localPath, html, "utf-8")
		const sha256 = createHash("sha256").update(html).digest("hex")

		// Register in installed.json
		const registryPath = path.join(os.homedir(), ".aihydro", "modules", "installed.json")
		let registry: Record<string, ModuleRegistryEntry> = {}
		try {
			registry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
		} catch {
			// registry doesn't exist yet — start fresh
		}
		registry[moduleId] = { id: moduleId, title, localPath, installedAt: new Date().toISOString(), version, sha256 }
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
