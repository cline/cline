import type { HubOAuthLoginResult } from "@cline/shared";
import { openExternalUrl } from "@/lib/desktop-client";
import { hubAccount } from "./hub-client";
import { setOAuthUserCode } from "./oauth-user-code";
import type { Provider } from "@/lib/provider-schema";

/**
 * Providers whose credentials are managed through an OAuth sign-in flow
 * rather than a pasted API key. Mirrors the SDK's provider auth registry
 * (see sdk/packages/core/src/auth/provider-auth-registry.ts); the catalog's
 * "oauth" capability is the primary signal and this set is the fallback for
 * entries whose capability metadata is incomplete.
 */
export const OAUTH_PROVIDER_IDS = new Set([
	"cline",
	// ClinePass shares the Cline account OAuth credentials (its auth handler
	// stores under the "cline" provider), so it never has its own API key.
	"cline-pass",
	"oca",
	"openai-codex",
]);

export type ProviderAuthKind = "oauth" | "local" | "api-key";

const attempts = new Map<
	string,
	{ controller: AbortController; done: Promise<HubOAuthLoginResult> }
>();
export async function cancelClineOAuthLogin(): Promise<void> {
	const entry = attempts.get("cline");
	entry?.controller.abort();
	await entry?.done.catch(() => undefined);
}
export async function runProviderOAuthLogin(
	provider: string,
	signal?: AbortSignal,
): Promise<HubOAuthLoginResult> {
	const previous = attempts.get(provider);
	previous?.controller.abort();
	signal?.throwIfAborted();
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal?.addEventListener("abort", abort, { once: true });
	const done = (async () => {
		await previous?.done.catch(() => undefined);
		controller.signal.throwIfAborted();
		setOAuthUserCode(null);
		return hubAccount.login(
			provider,
			{
				onAuth: (info) => {
					void openExternalUrl(info.url).catch(() => controller.abort());
				},
				onUserCode: setOAuthUserCode,
				onPrompt: async (prompt) => prompt.defaultValue ?? "",
			},
			controller.signal,
		);
	})();
	const entry = { controller, done };
	attempts.set(provider, entry);
	try {
		return await done;
	} finally {
		signal?.removeEventListener("abort", abort);
		if (attempts.get(provider) === entry) {
			attempts.delete(provider);
			setOAuthUserCode(null);
		}
	}
}

/**
 * How a provider expects to be authenticated, which drives which connect UI
 * to show: a browser sign-in button (oauth), a "uses your local CLI" notice
 * (local), or credential fields (api-key).
 */
export function getProviderAuthKind(provider: Provider): ProviderAuthKind {
	if (
		provider.capabilities?.includes("oauth") ||
		OAUTH_PROVIDER_IDS.has(provider.id)
	) {
		return "oauth";
	}
	if (provider.capabilities?.includes("local-auth")) {
		return "local";
	}
	return "api-key";
}

/**
 * Whether a provider from the catalog is usable for turns, shown as
 * "Configured" in settings and consulted by the first-run "connect a model"
 * notice. Plain API keys and OAuth are definitive. Beyond those, we rely on
 * the Hub's `configured` flag (the same per-provider readiness check the
 * CLI uses), which requires real evidence of credentials: cloud credentials
 * for Bedrock/Vertex/SAP AI Core, a local-auth CLI, or a resolvable endpoint
 * + model for keyless local providers like Ollama. `enabled` alone is not
 * enough — legacy VS Code migration and empty saves can persist entries for
 * providers the user never actually configured.
 */
export function isProviderConnected(provider: Provider): boolean {
	if (provider.apiKey?.trim()) {
		return true;
	}
	if (provider.oauthAccessTokenPresent) {
		return true;
	}
	return provider.enabled && provider.configured === true;
}
