import { ExtensionRegistryInfo } from "@/registry"

/**
 * Gets the latest announcement ID based on the extension version
 * Uses major.minor version format (e.g., "1.2" from "1.2.3")
 *
 * @param context The VSCode extension context
 * @returns The announcement ID string (major.minor version) or empty string if unavailable
 */
export function getLatestAnnouncementId(): string {
	const version = ExtensionRegistryInfo.version
	return version.split(".").slice(0, 2).join(".")
}
