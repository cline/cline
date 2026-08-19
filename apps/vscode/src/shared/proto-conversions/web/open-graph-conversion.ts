import { OpenGraphData as DomainOpenGraphData } from "@integrations/misc/link-preview"
import { OpenGraphData as ProtoOpenGraphData } from "@shared/proto/cline/web"

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
