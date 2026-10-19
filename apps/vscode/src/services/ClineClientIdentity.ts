import { setClineClientIdentity } from "@cline/shared"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { ClineClient } from "@/shared/cline"
import { EmptyRequest } from "@/shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"

export async function registerClineClientIdentity(): Promise<void> {
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		setClineClientIdentity({
			name: host.clineType || ClineClient.VSCode,
			version: host.clineVersion || ExtensionRegistryInfo.version,
			platform: host.platform || undefined,
			platformVersion: host.version || undefined,
		})
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		setClineClientIdentity({
			name: ClineClient.VSCode,
			version: ExtensionRegistryInfo.version,
		})
	}
}
