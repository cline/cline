/**
 * Resolve the LM Studio credential shared by model discovery and inference.
 * Persisted provider settings take precedence over the process environment;
 * an absent credential keeps local unauthenticated servers working.
 */
export function resolveLmStudioApiKey(storedApiKey?: string): string | undefined {
	return storedApiKey?.trim() || process.env.LMSTUDIO_API_KEY?.trim() || undefined
}
