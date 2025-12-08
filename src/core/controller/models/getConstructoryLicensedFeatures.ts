import { EmptyRequest, StringArray } from "@shared/proto/cline/common"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Fetches licensed features from Constructory
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the licensed features
 */
export async function getConstructoryLicensedFeatures(_controller: Controller, _request: EmptyRequest): Promise<StringArray> {
	try {
		const baseURL = process.env.RESEARCH_API_SERVER ?? "https://stage-constructor.dev"
		const sessionToken = process.env.RESEARCH_SDK_TOKEN ?? "KL5ISS6O2R7B0SP9HU1CECUVZ5GMY746"

		if (!baseURL || !sessionToken) {
			console.error("RESEARCH_API_SERVER or RESEARCH_SDK_TOKEN not configured")
			return StringArray.create({ values: [] })
		}

		const licensedFeaturesEndpoint = `${baseURL}/api/platform-kmapi/v1/users/licensed-features`

		const response = await axios.get(licensedFeaturesEndpoint, {
			headers: {
				"X-CTR-Session-Token": sessionToken,
			},
			...getAxiosSettings(),
		})

		if (!response.data || !Array.isArray(response.data.results)) {
			console.error("Invalid response from Constructory Licensed Features API:", response.data)
			return StringArray.create({ values: [] })
		}

		const licensedFeatures = response.data.results || []

		console.log(`Fetched ${licensedFeatures.length} licensed features`)
		console.log(licensedFeatures)
		return StringArray.create({ values: licensedFeatures })
	} catch (error) {
		console.error("Failed to fetch licensed features:", error)
		return StringArray.create({ values: [] })
	}
}
