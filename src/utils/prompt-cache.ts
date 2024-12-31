import { OpenAI } from 'openai';

/**
 * Helper function to structure prompts for optimal caching.
 * Places static content at the beginning and variable content at the end
 * to maximize cache hits for OpenAI and DeepSeek models that use automatic caching.
 * 
 * Note: OpenRouter handles provider-specific caching:
 * - OpenAI/DeepSeek: Automatic caching (no configuration needed)
 * - Anthropic Claude: Requires cache_control breakpoints (handled by OpenRouter)
 */
export function structurePromptForCaching(
  systemPrompt: string,
  staticMessages: OpenAI.Chat.ChatCompletionMessageParam[],
  variableMessages: OpenAI.Chat.ChatCompletionMessageParam[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    // Static content first (for cache hits)
    { role: "system", content: systemPrompt },
    ...staticMessages,
    // Variable content last
    ...variableMessages
  ];
}

/**
 * Extracts cache information from OpenAI API responses.
 * Returns the number of tokens that were cached in this request.
 * 
 * Note: For OpenRouter:
 * - OpenAI models: Cache reads cost 0.5x input price
 * - Anthropic models: Cache writes cost 1.25x, reads cost 0.1x
 * - DeepSeek models: Cache writes at normal price, reads cost 0.1x
 */
export function getCacheInfo(response: OpenAI.Chat.ChatCompletion & {
  usage?: {
    prompt_tokens_details?: {
      cached_tokens: number;
    };
  };
}): number {
  return response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
}

/**
 * Calculates the potential cache savings for a prompt.
 * Returns the number of tokens that could be cached based on OpenAI's rules.
 * 
 * Note: Only OpenAI/DeepSeek models use automatic caching with these rules.
 * Anthropic models use cache_control breakpoints instead (handled by OpenRouter).
 */
export function calculatePotentialCacheTokens(totalTokens: number): number {
  if (totalTokens < 1024) {
    return 0;
  }
  
  // Calculate cached tokens in 128 token increments
  const tokenIncrements = Math.floor((totalTokens - 1024) / 128);
  return 1024 + (tokenIncrements * 128);
}

/**
 * Helper to determine if a prompt is eligible for automatic caching.
 * Only applies to OpenAI/DeepSeek models that require 1024+ tokens.
 * Anthropic models use different caching rules via cache_control.
 */
export function isPromptCacheEligible(totalTokens: number): boolean {
  return totalTokens >= 1024;
}
