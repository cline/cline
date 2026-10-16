import fs from "node:fs"
import path from "node:path"
import { Logger } from "@/shared/services/Logger"
import type { StorageContext } from "@/shared/storage/storage-context"

const MIGRATED_KEY = "__openAiBaseUrlV1Migrated"

/**
 * The legacy provider-settings migration seeds models.json with the user's own
 * base URL for `openai-compatible`. Earlier SDK builds took the default path
 * from that entry instead of the SDK's `https://api.openai.com/v1`, so those
 * users had a host-only URL used as entered.
 */
function readPreviousDefaultPath(dataDir: string): string {
	try {
		const models = JSON.parse(fs.readFileSync(path.join(dataDir, "settings", "models.json"), "utf8"))
		const provider = models?.providers?.["openai-compatible"]?.provider
		if (typeof provider?.name === "string" && typeof provider?.baseUrl === "string") {
			return URL.canParse(provider.baseUrl) ? new URL(provider.baseUrl).pathname : "/"
		}
	} catch {
		// No readable models.json: the SDK default applied.
	}
	return "/v1"
}

/**
 * Earlier SDK builds gave an OpenAI Compatible base URL with no path
 * (`http://localhost:8000`) the provider default's path, usually `/v1`; the URL
 * is now used as entered. Save that path so existing setups keep reaching the
 * same endpoint.
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
		const defaultPath = readPreviousDefaultPath(storage.dataDir)
		if (url.pathname === "/" && defaultPath !== "/") {
			url.pathname = defaultPath
			storage.globalState.update("openAiBaseUrl", url.toString().replace(/\/$/, ""))
			Logger.info("[Migration] Added the default path to the host-only OpenAI Compatible base URL")
		}
	}
	storage.globalState.update(MIGRATED_KEY, true)
}
