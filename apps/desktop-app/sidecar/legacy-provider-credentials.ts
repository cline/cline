import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

/**
 * Legacy VS Code extension secrets.json keys that the legacy import in
 * ProviderSettingsManager turns back into a providers.json entry.
 */
const LEGACY_SECRET_KEYS_BY_PROVIDER: Record<string, string[]> = {
	"openai-codex": ["openai-codex-oauth-credentials"],
	cline: ["cline:clineAccountId", "clineApiKey"],
};

/**
 * Removes a provider's credentials from the legacy VS Code extension's
 * secrets.json. The legacy import in ProviderSettingsManager runs on
 * construction and re-adds any provider missing from providers.json, so
 * leaving these credentials on disk would sign the user straight back in
 * after they sign out in the desktop app. Temporary until the legacy import
 * is retired.
 *
 * A missing or unparseable file is a no-op (the import ignores those too).
 * A failed write throws so the sign-out is reported as failed instead of
 * succeeding and then being undone by the next import.
 */
export function clearLegacyProviderCredentials(
	providerId: string,
	dataDir: string = resolveClineDataDir(),
): boolean {
	const keys = LEGACY_SECRET_KEYS_BY_PROVIDER[providerId];
	const secretsPath = join(dataDir, "secrets.json");
	if (!keys || !existsSync(secretsPath)) {
		return false;
	}
	let secrets: unknown;
	try {
		secrets = JSON.parse(readFileSync(secretsPath, "utf8"));
	} catch {
		return false;
	}
	if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
		return false;
	}
	const present = keys.filter((key) => key in secrets);
	if (present.length === 0) {
		return false;
	}
	for (const key of present) {
		delete (secrets as Record<string, unknown>)[key];
	}
	writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	return true;
}
