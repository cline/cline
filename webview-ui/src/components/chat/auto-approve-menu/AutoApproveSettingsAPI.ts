import { StateServiceClient } from "@/services/grpc-client"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { convertAutoApprovalSettingsToProto } from "@shared/proto-conversions/models/auto-approval-settings-conversion"

/**
 * Updates auto approval settings using the gRPC/Protobus client
 * @param settings The auto approval settings to update
 * @throws Error if the update fails
 */
export async function updateAutoApproveSettings(settings: AutoApprovalSettings) {
	try {
		const protoSettings = convertAutoApprovalSettingsToProto(settings)
		await StateServiceClient.updateAutoApprovalSettings(protoSettings)
	} catch (error) {
		console.error("Failed to update auto approval settings:", error)
		throw error
	}
}
