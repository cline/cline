import type { EmptyRequest } from "@shared/proto/cline/common"
import { CourseCatalog } from "@shared/proto/cline/html_preview"
import type { Controller } from "../index"

export async function refreshCoursesMarketplace(controller: Controller, _request: EmptyRequest): Promise<CourseCatalog> {
	try {
		const catalog = await controller.silentlyRefreshCoursesMarketplaceRPC()
		if (catalog) return catalog as CourseCatalog
		return CourseCatalog.create({ items: [] })
	} catch (error) {
		console.error("Failed to refresh courses marketplace:", error)
		return CourseCatalog.create({ items: [] })
	}
}
