import { createAiSdkProvider } from "./ai-sdk";
import { resolveClineProviderErrorInfo } from "./cline-errors";

export const createClineProvider = createAiSdkProvider("openai-compatible", {
	resolveErrorInfo: resolveClineProviderErrorInfo,
});
