import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
const LEGACY_CODEX_SECRET_KEY = "openai-codex-oauth-credentials";

/**
 * Removes the ChatGPT (Codex) OAuth credentials from the legacy VS Code
 * extension's secrets.json. The legacy import in ProviderSettingsManager runs
 * on construction and re-adds any provider missing from providers.json, so
 * leaving these credentials on disk would sign the user straight back in
 * after they sign out in the desktop app. Temporary until the legacy import
 * is retired.
 */
export function clearLegacyCodexCredentials(
	dataDir: string = resolveClineDataDir(),
): boolean {
	const secretsPath = join(dataDir, "secrets.json");
	if (!existsSync(secretsPath)) {
		return false;
	}
	try {
		const secrets = JSON.parse(readFileSync(secretsPath, "utf8")) as unknown;
		if (
			!secrets ||
			typeof secrets !== "object" ||
			Array.isArray(secrets) ||
			!(LEGACY_CODEX_SECRET_KEY in secrets)
		) {
			return false;
		}
		delete (secrets as Record<string, unknown>)[LEGACY_CODEX_SECRET_KEY];
		writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		return true;
	} catch (error) {
		console.warn("Failed to clear legacy Codex credentials", error);
		return false;
	}
}
