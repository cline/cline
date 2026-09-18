import { ProviderSettingsManager } from "@cline/core"
import { ClineEnv } from "@/config"
import { resolveClineClientIdentity } from "@/services/ClineClientIdentity"
import { fetch } from "@/shared/net"
import { getProviderSettingsManager } from "./provider-migration"

let cached: { key: string; manager: ProviderSettingsManager } | undefined
/** Resolve host identity before allowing any catalog request. */
export async function getModelProviderSettingsManager(): Promise<ProviderSettingsManager> {
	const baseUrl = ClineEnv.config().apiBaseUrl
	const filePath = getProviderSettingsManager().getFilePath()
	const client = await resolveClineClientIdentity()
	const key = JSON.stringify([filePath, baseUrl, client])
	if (!cached || cached.key !== key) {
		cached = { key, manager: new ProviderSettingsManager({ filePath, client, baseUrl, fetchImpl: fetch }) }
	}
	return cached.manager
}
