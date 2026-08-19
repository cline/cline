import { useEffect, useState } from "react"
import { z } from "zod"

const CACHE_DURATION_MS = 30 * 1000 // 30 seconds
const OpenRouterBaseURL = "https://openrouter.ai/api/v1"

// Define schema for OpenRouter key response
const openRouterKeyInfoSchema = z.object({
	data: z.object({
		label: z.string().nullable(),
		usage: z.number(),
		is_free_tier: z.boolean(),
		is_provisioning_key: z.boolean(),
		rate_limit: z.object({
			requests: z.number(),
			interval: z.string(),
		}),
		limit: z.number().nullable(),
	}),
})
export type OpenRouterKeyInfo = z.infer<typeof openRouterKeyInfoSchema>["data"]

// Module-level cache variables
let moduleCachedData: OpenRouterKeyInfo | null = null
let moduleLastFetchTime: number | null = null

async function getOpenRouterKeyInfo(apiKey: string, signal: AbortSignal): Promise<OpenRouterKeyInfo | null> {
	try {
		const keyEndpoint = `${OpenRouterBaseURL}/key`
		const response = await fetch(keyEndpoint, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			signal,
		})

		if (!response.ok) {
			if (response.status === 401) {
				console.warn("OpenRouter API key is invalid or unauthorized.")
			} else {
				console.error(`Error fetching OpenRouter key info: HTTP ${response.status}`)
			}
			return null
		}

		const responseData = await response.json()
		const result = openRouterKeyInfoSchema.safeParse(responseData)
		if (!result.success) {
			console.error("OpenRouter API key info validation failed:", result.error.flatten().fieldErrors)
			return null
		}
		return result.data.data
	} catch (error: any) {
		if (error.name !== "AbortError") {
			console.error("Error fetching OpenRouter key info:", error)
		}
		return null
	}
}

/**
 * Custom hook to fetch OpenRouter API key information.
 * Implements stale-while-revalidate caching using module-level variables.
 * @param apiKey The OpenRouter API key.
 * @returns An object containing the key info data, loading state, and error state.
 */
export const useOpenRouterKeyInfo = (apiKey?: string) => {
	// State reflects the currently displayed data, initialized from cache
	const [data, setData] = useState<OpenRouterKeyInfo | null>(moduleCachedData)
	// Loading is true only if there's no initial cache and a key is provided
	const [isLoading, setIsLoading] = useState<boolean>(!moduleCachedData && !!apiKey)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		const controller = new AbortController()
		const signal = controller.signal

		if (!apiKey) {
			// Clear state and cache if API key is removed
			setData(null)
			moduleCachedData = null
			moduleLastFetchTime = null
			setIsLoading(false)
			setError(null)
			return () => controller.abort()
		}

		const now = Date.now()
		const cacheAge = moduleLastFetchTime ? now - moduleLastFetchTime : Infinity
		const isCacheStale = cacheAge >= CACHE_DURATION_MS
		const hasCache = !!moduleCachedData

		// Use cached data immediately if available
		if (hasCache) {
			// Ensure local state matches module cache if it hasn't updated yet
			// This handles cases where the hook re-renders before the effect runs
			if (data !== moduleCachedData) {
				setData(moduleCachedData)
			}
			setIsLoading(false)
		} else {
			setIsLoading(true)
			setError(null)
		}

		// Fetch if cache is stale or doesn't exist
		if (isCacheStale || !hasCache) {
			const isBackgroundFetch = hasCache && isCacheStale // Fetching while showing stale data

			// Don't set loading true for background fetches
			if (!isBackgroundFetch) {
				setIsLoading(true)
			}

			getOpenRouterKeyInfo(apiKey, signal)
				.then((result) => {
					if (!signal.aborted) {
						moduleCachedData = result // Update module cache
						moduleLastFetchTime = Date.now() // Update module fetch time
						setData(result) // Update state
						setError(null) // Clear error on success
					}
				})
				.catch((err) => {
					if (!signal.aborted) {
						console.error("[useOpenRouterKeyInfo] Fetch error:", err)
						setError(err instanceof Error ? err : new Error("An unknown error occurred"))
						if (!isBackgroundFetch) {
							setData(null)
							moduleCachedData = null
							moduleLastFetchTime = null
						}
					}
				})
				.finally(() => {
					if (!signal.aborted) {
						setIsLoading(false) // Stop loading indicator
					}
				})
		}

		return () => {
			controller.abort()
		}
	}, [apiKey]) // Re-run effect only when apiKey changes

	return { data, isLoading, error }
}
