// Some providers list environment variables in `apiKeyEnv` that are not API
// keys: the runtime reads them for other settings (region, IAM credentials,
// profile) and skips them when it looks up the provider's API key.
const NON_API_KEY_ENV_BY_PROVIDER: Readonly<
	Record<string, ReadonlySet<string>>
> = {
	// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/amazon-bedrock
	bedrock: new Set([
		"AWS_ACCESS_KEY_ID",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_SESSION_TOKEN",
		"AWS_REGION",
		"AWS_DEFAULT_REGION",
		"AWS_PROFILE",
	]),
};

/**
 * Whether the runtime reads the environment variable `name` as the API key of
 * `providerId` when no key is configured.
 */
export function isProviderApiKeyEnv(providerId: string, name: string): boolean {
	return !NON_API_KEY_ENV_BY_PROVIDER[providerId]?.has(name);
}
