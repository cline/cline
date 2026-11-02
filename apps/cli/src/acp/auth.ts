import type { ProviderSettingsManager } from "@cline/core";
import { loginAndSaveProviderOAuthCredentials } from "@cline/core";
import { getPersistedProviderApiKey } from "../commands/auth";
import { writeDiagnostic } from "../utils/output";

/**
 * Supported ACP OAuth provider IDs.
 *
 * This list doubles as the set of selectable providers (see
 * `setSessionConfigOption`)
 */
export const ACP_AUTH_METHODS = [
	{ id: "cline", name: "Sign in with Cline" },
	{ id: "cline-pass", name: "Sign in with ClinePass" },
	{ id: "openai-codex", name: "Sign in with ChatGPT Subscription" },
] as const;

export type AcpAuthMethodId = (typeof ACP_AUTH_METHODS)[number]["id"];

export function isAcpAuthMethodId(id: string): id is AcpAuthMethodId {
	return ACP_AUTH_METHODS.some((m) => m.id === id);
}

/**
 * Order in which persisted ACP credentials are tried when a session needs
 * credentials before the client authenticated explicitly.
 *
 * An ACP host may pin the provider through `CLINE_PROVIDER`, and
 * `providers.json` remembers the provider the user picked last, so both win
 * over the declaration order. Without that, a ClinePass subscriber whose
 * credentials for plain `cline` also exist would silently be served the
 * `cline` key — wrong account, and a `cline-pass/…` model id that does not
 * exist in the `cline` catalog.
 */
export function resolveAcpAuthCandidates(input: {
	envProvider?: string;
	lastUsedProvider?: string;
}): AcpAuthMethodId[] {
	const preferred = [
		input.envProvider?.trim(),
		input.lastUsedProvider?.trim(),
	].filter((id): id is AcpAuthMethodId => !!id && isAcpAuthMethodId(id));

	return [
		...new Set<AcpAuthMethodId>([
			...preferred,
			...ACP_AUTH_METHODS.map((m) => m.id),
		]),
	];
}

/**
 * Perform an OAuth login for the given provider in ACP mode.
 *
 * Since stdin/stdout are used for the JSON-RPC transport, all user-facing
 * output is written to stderr and URLs are opened via the `open` package.
 * If the OAuth flow requires interactive prompts (rare), defaults are used
 * when available; otherwise an error is thrown.
 */
async function performOAuthLogin(input: {
	providerId: AcpAuthMethodId;
	providerSettingsManager: ProviderSettingsManager;
}): Promise<string> {
	const [{ createOAuthClientCallbacks }, { default: open }] = await Promise.all(
		[import("@cline/core"), import("../utils/open")],
	);

	const callbacks = createOAuthClientCallbacks({
		onPrompt: ({ defaultValue }) => {
			if (defaultValue) {
				return Promise.resolve(defaultValue);
			}
			return Promise.reject(
				new Error(
					"OAuth flow requires interactive input which is unavailable in ACP mode",
				),
			);
		},
		onOutput: (message) => writeDiagnostic(`[acp/auth] ${message}`),
		openUrl: (url) => open(url, { wait: false }).then(() => undefined),
		onOpenUrlError: ({ url }) => {
			writeDiagnostic(
				`[acp/auth] Could not open browser automatically. Open this URL manually:\n${url}`,
			);
		},
	});

	const settings = await loginAndSaveProviderOAuthCredentials(
		input.providerSettingsManager,
		input.providerId,
		{ callbacks },
	);
	const apiKey = getPersistedProviderApiKey(input.providerId, settings);
	if (!apiKey) {
		throw new Error(
			`OAuth login did not persist credentials for ${input.providerId}`,
		);
	}
	return apiKey;
}

export interface AcpAuthResult {
	providerId: AcpAuthMethodId;
	apiKey: string;
}

/**
 * Authenticate via OAuth for the given ACP auth method.
 *
 * Uses `ProviderSettingsManager` to check for existing credentials first,
 * falling back to a fresh OAuth login if needed.
 */
export async function authenticateAcpProvider(
	methodId: AcpAuthMethodId,
	providerSettingsManager: ProviderSettingsManager,
): Promise<AcpAuthResult> {
	const existing = providerSettingsManager.getProviderSettings(methodId);

	// Check for already-stored credentials.
	const existingKey = getPersistedProviderApiKey(methodId, existing);
	if (existingKey) {
		writeDiagnostic(`[acp/auth] Using existing credentials for ${methodId}`);
		return { providerId: methodId, apiKey: existingKey };
	}

	// Perform a fresh OAuth login.
	writeDiagnostic(`[acp/auth] Starting OAuth login for ${methodId}…`);
	const apiKey = await performOAuthLogin({
		providerId: methodId,
		providerSettingsManager,
	});
	writeDiagnostic(`[acp/auth] Successfully authenticated with ${methodId}`);
	return { providerId: methodId, apiKey };
}
