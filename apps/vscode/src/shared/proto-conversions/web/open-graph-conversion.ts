import { OpenGraphData as ProtoOpenGraphData } from "@shared/proto/cline/web"

type DomainOpenGraphData = {
	title?: string
	description?: string
	image?: string
	url?: string
	siteName?: string
	type?: string
}

/**
 * Converts domain OpenGraphData objects to proto OpenGraphData objects
 * @param ogData Domain OpenGraphData object
 * @returns Proto OpenGraphData object
 */
export function convertDomainOpenGraphDataToProto(ogData: DomainOpenGraphData): ProtoOpenGraphData {
	return ProtoOpenGraphData.create({
		title: ogData.title || "",
		description: ogData.description || "",
		image: ogData.image || "",
		url: ogData.url || "",
		siteName: ogData.siteName || "",
		type: ogData.type || "",
	})
}
