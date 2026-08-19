import type { ProviderId } from "./contracts"

/**
 * Convert the extension's provider id spelling to the SDK's provider id.
 *
 * Extension config/storage keeps provider ids lowercased for cross-version
 * portability, while the SDK registry uses a few specific spellings:
 *
 * - `nousresearch` → `nousResearch`: same provider, case-sensitive SDK id.
 * - `openai` → `openai-compatible`: the extension stores the OpenAI Compatible
 *   provider (user-supplied base URL + arbitrary chat-completions model) under
 *   the id `openai`, but the SDK registers that built-in as `openai-compatible`
 *   and routes it through the chat-completions client. Using the SDK id keeps
 *   the extension aligned with the CLI and lets the SDK's provider registry and
 *   model catalog resolve the provider; passing `openai` instead is rejected as
 *   an unknown provider.
 *
 * Any id without an entry here is passed through unchanged.
 */
const EXTENSION_TO_SDK_PROVIDER_ID: Readonly<Record<string, string>> = {
	nousresearch: "nousResearch",
	openai: "openai-compatible",
}

export function toSdkProviderId(providerId: ProviderId | string): string {
	return EXTENSION_TO_SDK_PROVIDER_ID[providerId.toString()] ?? providerId.toString()
}
