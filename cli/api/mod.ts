import type { ApiConfiguration, ApiHandler } from "../types.d.ts";
import { OpenRouterHandler } from "./providers/openrouter.ts";

// Re-export the ApiHandler interface
export type { ApiHandler };

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
  const { apiKey, model } = configuration;
  return new OpenRouterHandler({ apiKey, model });
}
