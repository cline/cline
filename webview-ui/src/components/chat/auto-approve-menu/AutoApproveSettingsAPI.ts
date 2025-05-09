import { StateServiceClient } from "@/services/grpc-client"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { convertAutoApprovalSettingsToProto } from "@shared/proto-conversions/models/auto-approval-settings-conversion"

// Updates auto approval settings using the gRPC/Protobus client
export async function updateAutoApproveSettings(settings: AutoApprovalSettings) {
	try {
		const protoSettings = convertAutoApprovalSettingsToProto(settings)
		await StateServiceClient.updateAutoApprovalSettings(protoSettings)
	} catch (error) {
		console.error("Failed to update auto approval settings:", error)
	}
}
