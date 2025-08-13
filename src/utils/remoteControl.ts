import type { CloudUserInfo } from "@roo-code/cloud"

/**
 * Determines if remote control features should be enabled
 * @param cloudUserInfo - User information from cloud service
 * @param remoteControlEnabled - User's remote control setting
 * @returns true if remote control should be enabled
 */
export function isRemoteControlEnabled(cloudUserInfo?: CloudUserInfo | null, remoteControlEnabled?: boolean): boolean {
	return !!(cloudUserInfo?.id && cloudUserInfo.extensionBridgeEnabled && remoteControlEnabled)
}
