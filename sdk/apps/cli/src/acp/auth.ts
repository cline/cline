import type { ProviderSettings, ProviderSettingsManager } from "@clinebot/core";
import type { OAuthCredentials } from "../commands/auth";
import {
	getPersistedProviderApiKey,
	saveOAuthProviderSettings,
	toProviderApiKey,
} from "../commands/auth";
import { writeErr } from "../utils/output";

/**
 * Supported ACP OAuth provider IDs.
 */
export const ACP_AUTH_METHODS = [
	{ id: "cline", name: "Sign in with Cline" },
	{ id: "openai-codex", name: "Sign in with ChatGPT Subscription" },
] as const;

export type AcpAuthMethodId = (typeof ACP_AUTH_METHODS)[number]["id"];

export function isAcpAuthMethodId(id: string): id is AcpAuthMethodId {
	return ACP_AUTH_METHODS.some((m) => m.id === id);
}

/**
 * Perform an OAuth login for the given provider in ACP mode.
 *
 * Since stdin/stdout are used for the JSON-RPC transport, all user-facing
 * output is written to stderr and URLs are opened via the `open` package.
 * If the OAuth flow requires interactive prompts (rare), defaults are used
 * when available; otherwise an error is thrown.
 */
async function performOAuthLogin(
	providerId: AcpAuthMethodId,
	existingSettings: ProviderSettings | undefined,
): Promise<OAuthCredentials> {
	const [{ createOAuthClientCallbacks }, { default: open }, coreOAuth] =
		await Promise.all([
			import("@clinebot/core"),
			import("open"),
			import("@clinebot/core").then((m) => ({
				loginClineOAuth: m.loginClineOAuth as (input: {
					useWorkOSDeviceAuth?: boolean;
					apiBaseUrl: string;
					callbacks: {
						onAuth: (info: { url: string; instructions?: string }) => void;
						onPrompt: (prompt: {
							message: string;
							defaultValue?: string;
						}) => Promise<string>;
						onManualCodeInput?: () => Promise<string>;
					};
				}) => Promise<OAuthCredentials>,
				loginOpenAICodex: m.loginOpenAICodex as (input: {
					onAuth: (info: { url: string; instructions?: string }) => void;
					onPrompt: (prompt: {
						message: string;
						defaultValue?: string;
					}) => Promise<string>;
					onManualCodeInput?: () => Promise<string>;
				}) => Promise<OAuthCredentials>,
			})),
		]);

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
		onOutput: (message) => writeErr(`[acp/auth] ${message}`),
		openUrl: (url) => open(url, { wait: false }).then(() => undefined),
		onOpenUrlError: ({ url }) => {
			writeErr(
				`[acp/auth] Could not open browser automatically. Open this URL manually:\n${url}`,
			);
		},
	});

	if (providerId === "cline") {
		return coreOAuth.loginClineOAuth({
			apiBaseUrl: existingSettings?.baseUrl?.trim() || "https://api.cline.bot",
			callbacks,
			useWorkOSDeviceAuth: true,
		});
	}

	// openai-codex
	return coreOAuth.loginOpenAICodex(callbacks);
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
		writeErr(`[acp/auth] Using existing credentials for ${methodId}`);
		return { providerId: methodId, apiKey: existingKey };
	}

	// Perform a fresh OAuth login.
	writeErr(`[acp/auth] Starting OAuth login for ${methodId}…`);
	const credentials = await performOAuthLogin(methodId, existing);

	saveOAuthProviderSettings(
		providerSettingsManager,
		methodId,
		existing,
		credentials,
	);

	const apiKey = toProviderApiKey(methodId, credentials);
	writeErr(`[acp/auth] Successfully authenticated with ${methodId}`);
	return { providerId: methodId, apiKey };
}
