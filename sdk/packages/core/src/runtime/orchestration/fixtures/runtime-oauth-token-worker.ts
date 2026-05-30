import { ProviderSettingsManager } from "../../../services/storage/provider-settings-manager";
import { RuntimeOAuthTokenManager } from "../runtime-oauth-token-manager";

const [filePath, tokenEndpoint] = process.argv.slice(2);
if (!filePath || !tokenEndpoint) {
	throw new Error("Expected providers.json path and token endpoint");
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (_input, init) => nativeFetch(tokenEndpoint, init);

const manager = new RuntimeOAuthTokenManager({
	providerSettingsManager: new ProviderSettingsManager({ filePath }),
});
const result = await manager.resolveProviderApiKey({
	providerId: "openai-codex",
});
process.stdout.write(`${JSON.stringify(result)}\n`);
