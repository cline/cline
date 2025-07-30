import { Controller } from ".."
import { StringRequest } from "@shared/proto/cline/common"
import { OpenGraphData } from "@shared/proto/cline/web"
import { fetchOpenGraphData as fetchOGData } from "../../../integrations/misc/link-preview"
import { convertDomainOpenGraphDataToProto } from "../../../shared/proto-conversions/web/open-graph-conversion"

/**
 * Fetches Open Graph metadata from a URL
 * @param controller The controller instance
 * @param request The request containing the URL to fetch metadata from
 * @returns Promise resolving to OpenGraphData
 */
export async function fetchOpenGraphData(controller: Controller, request: StringRequest): Promise<OpenGraphData> {
	try {
		const url = request.value || ""
		// Fetch open graph data using the existing utility
		const ogData = await fetchOGData(url)

		// Convert domain model to proto model
		return convertDomainOpenGraphDataToProto(ogData)
	} catch (error) {
		console.error(`Error fetching Open Graph data: ${request.value}`, error)
		// Return empty OpenGraphData object
		return OpenGraphData.create({})
	}
}
