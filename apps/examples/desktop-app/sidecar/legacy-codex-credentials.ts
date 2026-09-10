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
 *
 * A missing or unparseable file is a no-op (the import ignores those too).
 * A failed write throws so the sign-out is reported as failed instead of
 * succeeding and then being undone by the next import.
 */
export function clearLegacyCodexCredentials(
	dataDir: string = resolveClineDataDir(),
): boolean {
	const secretsPath = join(dataDir, "secrets.json");
	if (!existsSync(secretsPath)) {
		return false;
	}
	let secrets: unknown;
	try {
		secrets = JSON.parse(readFileSync(secretsPath, "utf8"));
	} catch {
		return false;
	}
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
}
