import type { EmptyRequest } from "@shared/proto/cline/common"
import { SkillCatalog } from "@shared/proto/cline/skills"
import type { Controller } from "../index"

export async function refreshSkillsMarketplace(controller: Controller, _request: EmptyRequest): Promise<SkillCatalog> {
	try {
		const catalog = await controller.silentlyRefreshSkillsMarketplaceRPC()
		if (catalog) {
			return catalog as SkillCatalog
		}
		return SkillCatalog.create({ items: [] })
	} catch (error) {
		console.error("Failed to refresh Skills marketplace:", error)
		return SkillCatalog.create({ items: [] })
	}
}
