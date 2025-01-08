import { OgToolsService } from "../../services/og-tools/OgToolsService"

export class OgTools {
	private ogToolsService: OgToolsService

	constructor(apiKey: string) {
		this.ogToolsService = new OgToolsService(apiKey)
	}

	async fetchUserStories(projectName: string) {
		try {
			const stories = await this.ogToolsService.fetchUserStories(projectName)
			return {
				success: true,
				data: stories,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to fetch user stories",
			}
		}
	}

	async fetchTechnicalDesign(projectName: string) {
		try {
			const design = await this.ogToolsService.fetchTechnicalDesign(projectName)
			return {
				success: true,
				data: design,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to fetch technical design",
			}
		}
	}
}
