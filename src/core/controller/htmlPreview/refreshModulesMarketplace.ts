import type { EmptyRequest } from "@shared/proto/cline/common"
import { LearningModuleCatalog } from "@shared/proto/cline/html_preview"
import type { Controller } from "../index"

export async function refreshModulesMarketplace(controller: Controller, _request: EmptyRequest): Promise<LearningModuleCatalog> {
	try {
		const catalog = await controller.silentlyRefreshModulesMarketplaceRPC()
		if (catalog) return catalog as LearningModuleCatalog
		return LearningModuleCatalog.create({ items: [] })
	} catch (error) {
		console.error("Failed to refresh modules marketplace:", error)
		return LearningModuleCatalog.create({ items: [] })
	}
}
