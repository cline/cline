/**
 * Handlers Index
 *
 * Re-exports all handler classes and factory functions.
 */

export {
	getMissingApiKeyError,
	getProviderEnvKeys,
	normalizeProviderId,
	resolveApiKeyForProvider,
} from "../runtime/auth";
// Provider configurations
export {
	clearLiveModelsCatalogCache,
	clearPrivateModelsCatalogCache,
	DEFAULT_MODELS_CATALOG_URL,
	getLiveModelsCatalog,
	getProviderConfig,
	isOpenAICompatibleProvider,
	OPENAI_COMPATIBLE_PROVIDERS,
	type ProviderDefaults,
	resolveProviderConfig,
} from "../runtime/provider-defaults";
// Custom handler registry
export {
	clearRegistry,
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	getRegisteredProviderIds,
	hasRegisteredHandler,
	isRegisteredHandlerAsync,
	registerAsyncHandler,
	registerHandler,
	unregisterHandler,
} from "../runtime/registry";
export { AnthropicHandler, createAnthropicHandler } from "./anthropic-base";
export { AskSageHandler, createAskSageHandler } from "./asksage";
// Base classes
export { BaseHandler } from "./base";
export { BedrockHandler, createBedrockHandler } from "./bedrock-base";
export {
	ClaudeCodeHandler,
	CodexHandler,
	createClaudeCodeHandler,
	createCodexHandler,
	createDifyHandler,
	createMistralHandler,
	createOpenCodeHandler,
	createSapAiCoreHandler,
	DifyHandler,
	MistralHandler,
	OpenCodeHandler,
	SapAiCoreHandler,
} from "./community-sdk";
export { FetchBaseHandler } from "./fetch-base";
export { createGeminiHandler, GeminiHandler } from "./gemini-base";
// OpenAI Chat Completions API handler
export { createOpenAIHandler, OpenAIBaseHandler } from "./openai-base";
export {
	createOpenAICompatibleHandler,
	OpenAICompatibleHandler,
} from "./openai-compatible";
// OpenAI Responses API handler
export {
	createOpenAIResponsesHandler,
	OpenAIResponsesHandler,
} from "./openai-responses";
// R1-based handlers (DeepSeek Reasoner, etc.)
export { createR1Handler, R1BaseHandler } from "./r1-base";
export { createVertexHandler, VertexHandler } from "./vertex";
