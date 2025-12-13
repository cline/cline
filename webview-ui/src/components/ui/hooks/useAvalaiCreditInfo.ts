import { useEffect, useState } from "react"
import { z } from "zod"

const CACHE_DURATION_MS = 30 * 1000 // 30 seconds
const AvalaiBaseURL = "https://api.avalai.ir"

// Define schema for AvalAI credit response
const avalaiCreditInfoSchema = z.object({
	limit: z.number(),
	remaining_irt: z.number(),
	remaining_unit: z.number(),
	total_unit: z.number(),
	exchange_rate: z.number(),
})
export type AvalaiCreditInfo = z.infer<typeof avalaiCreditInfoSchema>

// Module-level cache variables
let moduleCachedData: AvalaiCreditInfo | null = null
let moduleLastFetchTime: number | null = null

async function getAvalaiCreditInfo(apiKey: string, signal: AbortSignal): Promise<AvalaiCreditInfo | null> {
	try {
		const creditEndpoint = `${AvalaiBaseURL}/user/credit`
		const response = await fetch(creditEndpoint, {
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			signal,
		})

		if (!response.ok) {
			if (response.status === 401) {
				console.warn("AvalAI API key is invalid or unauthorized.")
			} else {
				console.error(`Error fetching AvalAI credit info: HTTP ${response.status}`)
			}
			return null
		}

		const responseData = await response.json()
		const result = avalaiCreditInfoSchema.safeParse(responseData)
		if (!result.success) {
			console.error("AvalAI credit info validation failed:", result.error.flatten().fieldErrors)
			return null
		}
		return result.data
	} catch (error: any) {
		if (error.name !== "AbortError") {
			console.error("Error fetching AvalAI credit info:", error)
		}
		return null
	}
}

/**
 * Custom hook to fetch AvalAI API credit information.
 * Implements stale-while-revalidate caching using module-level variables.
 * @param apiKey The AvalAI API key.
 * @returns An object containing the credit info data, loading state, and error state.
 */
export const useAvalaiCreditInfo = (apiKey?: string) => {
	// State reflects the currently displayed data, initialized from cache
	const [data, setData] = useState<AvalaiCreditInfo | null>(moduleCachedData)
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

			getAvalaiCreditInfo(apiKey, signal)
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
						console.error("[useAvalaiCreditInfo] Fetch error:", err)
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
