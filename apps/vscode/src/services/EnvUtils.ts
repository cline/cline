import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo, HostRegistryInfo } from "@/registry"
import { Logger } from "@/shared/services/Logger"

// Canonical header names for extra client/host context
const ClineHeaders = {
	PLATFORM: "X-PLATFORM",
	PLATFORM_VERSION: "X-PLATFORM-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
	CLIENT_TYPE: "X-CLIENT-TYPE",
	CORE_VERSION: "X-CORE-VERSION",
	IS_MULTIROOT: "X-IS-MULTIROOT",
} as const

interface HostRuntimeInfo {
	platform: string
	platformVersion: string
	clientName: string
	clientVersion: string
}

export interface ClientRuntimeContext {
	platform: string
	platformVersion: string
	clientName: string
	clientVersion: string
	userAgent: string
	coreVersion: string
	isMultiRoot: boolean
}

export function buildExternalBasicHeaders(): Record<string, string> {
	return {
		"User-Agent": `Cline/${ExtensionRegistryInfo.version}`,
	}
}

function getHostRuntimeInfo(): HostRuntimeInfo {
	const host = HostRegistryInfo.get()

	if (host) {
		return {
			platform: host.platform || "unknown",
			platformVersion: host.hostVersion || "unknown",
			clientName: host.ide || "unknown",
			clientVersion: host.extensionVersion || ExtensionRegistryInfo.version,
		}
	}

	Logger.log("HostRegistryInfo is not initialized; falling back to unknown host runtime info.")
	return {
		platform: "unknown",
		platformVersion: "unknown",
		clientName: "unknown",
		clientVersion: ExtensionRegistryInfo.version,
	}
}

async function isMultiRootWorkspace(): Promise<boolean> {
	try {
		const { paths } = await HostProvider.workspace.getWorkspacePaths({})
		return paths.length > 1
	} catch (error) {
		Logger.log("Failed to detect multi-root workspace", error)
		return false
	}
}

export async function buildClientRuntimeContext(): Promise<ClientRuntimeContext> {
	const host = getHostRuntimeInfo()
	return {
		...host,
		userAgent: buildExternalBasicHeaders()["User-Agent"],
		coreVersion: ExtensionRegistryInfo.version,
		isMultiRoot: await isMultiRootWorkspace(),
	}
}

export function buildBasicClineHeaders(): Record<string, string> {
	const host = getHostRuntimeInfo()
	const headers: Record<string, string> = buildExternalBasicHeaders()
	headers[ClineHeaders.PLATFORM] = host.platform
	headers[ClineHeaders.PLATFORM_VERSION] = host.platformVersion
	headers[ClineHeaders.CLIENT_TYPE] = host.clientName
	headers[ClineHeaders.CLIENT_VERSION] = host.clientVersion
	headers[ClineHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	return headers
}
