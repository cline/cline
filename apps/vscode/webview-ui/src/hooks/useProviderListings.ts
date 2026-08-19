import { Empty } from "@shared/proto/cline/common"
import type { ProviderListing } from "@shared/proto/cline/models"
import { useCallback, useEffect, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"

export function useProviderListings() {
	const [providers, setProviders] = useState<ProviderListing[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | undefined>(undefined)

	const refresh = useCallback(async () => {
		setIsLoading(true)
		setError(undefined)
		try {
			const response = await ModelsServiceClient.listProviders(Empty.create())
			setProviders(response.providers)
			return response.providers
		} catch (err) {
			const normalizedError = err instanceof Error ? err : new Error(String(err))
			setError(normalizedError)
			console.error("Failed to list provider catalog entries:", normalizedError)
			return []
		} finally {
			setIsLoading(false)
		}
	}, [])

	useEffect(() => {
		void refresh()
	}, [refresh])

	return { providers, isLoading, error, refresh }
}
