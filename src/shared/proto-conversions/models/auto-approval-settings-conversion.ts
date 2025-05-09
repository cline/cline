import { AutoApprovalSettings } from "../../AutoApprovalSettings"
import { AutoApprovalSettingsRequest } from "../../proto/state"
import { Metadata } from "../../proto/common"

// Converts domain AutoApprovalSettings to proto AutoApprovalSettingsRequest
export function convertAutoApprovalSettingsToProto(settings: AutoApprovalSettings): AutoApprovalSettingsRequest {
	return {
		metadata: {
			timestamp: Date.now(),
			clientVersion: process.env.VERSION || "1.0.0",
		} as Metadata,
		version: settings.version,
		enabled: settings.enabled,
		actions: {
			readFiles: settings.actions.readFiles || false,
			readFilesExternally: settings.actions.readFilesExternally || false,
			editFiles: settings.actions.editFiles || false,
			editFilesExternally: settings.actions.editFilesExternally || false,
			executeSafeCommands: settings.actions.executeSafeCommands || false,
			executeAllCommands: settings.actions.executeAllCommands || false,
			useBrowser: settings.actions.useBrowser || false,
			useMcp: settings.actions.useMcp || false,
		},
		maxRequests: settings.maxRequests,
		enableNotifications: settings.enableNotifications,
		favorites: settings.favorites,
	}
}

// Converts proto AutoApprovalSettingsRequest to domain AutoApprovalSettings
export function convertProtoToAutoApprovalSettings(protoSettings: AutoApprovalSettingsRequest): AutoApprovalSettings {
	return {
		version: protoSettings.version,
		enabled: protoSettings.enabled,
		actions: {
			readFiles: protoSettings.actions?.readFiles || false,
			readFilesExternally: protoSettings.actions?.readFilesExternally || false,
			editFiles: protoSettings.actions?.editFiles || false,
			editFilesExternally: protoSettings.actions?.editFilesExternally || false,
			executeSafeCommands: protoSettings.actions?.executeSafeCommands || false,
			executeAllCommands: protoSettings.actions?.executeAllCommands || false,
			useBrowser: protoSettings.actions?.useBrowser || false,
			useMcp: protoSettings.actions?.useMcp || false,
		},
		maxRequests: protoSettings.maxRequests,
		enableNotifications: protoSettings.enableNotifications,
		favorites: protoSettings.favorites || [],
	}
}
