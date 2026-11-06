import { Logger } from "@/shared/services/Logger"
import type { StorageContext } from "@/shared/storage/storage-context"

const MIGRATED_KEY = "__openAiBaseUrlV1Migrated"

/**
 * Earlier SDK builds sent requests for an OpenAI Compatible base URL with no
 * path (`http://localhost:8000`) to `<host>/v1`; the URL is now used as entered.
 * Save the `/v1` so existing setups keep reaching the same endpoint.
 *
 * Runs once across all hosts: the marker lives in the shared globalState.json
 * and is set even when there is nothing to rewrite, so a host-only URL saved
 * afterwards (in any host) stays as entered.
 */
export function migrateOpenAiCompatibleBaseUrlToV1(storage: StorageContext): void {
	if (storage.globalState.get(MIGRATED_KEY)) {
		return
	}
	const baseUrl = storage.globalState.get<string>("openAiBaseUrl")?.trim()
	if (baseUrl && URL.canParse(baseUrl)) {
		const url = new URL(baseUrl)
		if (url.pathname === "/") {
			url.pathname = "/v1"
			storage.globalState.update("openAiBaseUrl", url.toString().replace(/\/$/, ""))
			Logger.info("[Migration] Added /v1 to the host-only OpenAI Compatible base URL")
		}
	}
	storage.globalState.update(MIGRATED_KEY, true)
}
