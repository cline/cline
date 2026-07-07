import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { EmptyRequest } from "@/shared/proto/cline/common"
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

async function getHostRuntimeInfo(): Promise<HostRuntimeInfo> {
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		return {
			platform: host.platform || "unknown",
			platformVersion: host.version || "unknown",
			clientName: host.clineType || "unknown",
			clientVersion: host.clineVersion || ExtensionRegistryInfo.version,
		}
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		return {
			platform: "unknown",
			platformVersion: "unknown",
			clientName: "unknown",
			clientVersion: ExtensionRegistryInfo.version,
		}
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
	const host = await getHostRuntimeInfo()
	return {
		...host,
		userAgent: buildExternalBasicHeaders()["User-Agent"],
		coreVersion: ExtensionRegistryInfo.version,
		isMultiRoot: await isMultiRootWorkspace(),
	}
}

export async function buildBasicClineHeaders(): Promise<Record<string, string>> {
	const host = await getHostRuntimeInfo()
	const headers: Record<string, string> = buildExternalBasicHeaders()
	headers[ClineHeaders.PLATFORM] = host.platform
	headers[ClineHeaders.PLATFORM_VERSION] = host.platformVersion
	headers[ClineHeaders.CLIENT_TYPE] = host.clientName
	headers[ClineHeaders.CLIENT_VERSION] = host.clientVersion
	headers[ClineHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	return headers
}
