import type { ProviderCapability } from "./models/types/index";
import {
	buildOpenAICompatibleProviderDefaults,
	type OpenAICompatibleProviderDefaults,
} from "./providers/runtime/openai-compatible";

export * as models from "./models/index";
export type { ProviderCapability } from "./models/types/index";

export interface CatalogProviderDefaults
	extends Omit<OpenAICompatibleProviderDefaults, "capabilities"> {
	capabilities?: ProviderCapability[];
}

export const OPENAI_COMPATIBLE_PROVIDERS: Record<
	string,
	CatalogProviderDefaults
> = buildOpenAICompatibleProviderDefaults({
	includeKnownModels: true,
});
