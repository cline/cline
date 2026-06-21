import { Empty } from "@shared/proto/cline/common"
import type { ProviderListing } from "@shared/proto/cline/models"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

export function useProviderListings() {
	const { remoteConfigSettings } = useExtensionState()
	const [providers, setProviders] = useState<ProviderListing[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | undefined>(undefined)
	const latestRequestIdRef = useRef(0)
	const remoteConfigKey = useMemo(() => JSON.stringify(remoteConfigSettings ?? {}), [remoteConfigSettings])

	const refresh = useCallback(async () => {
		const requestId = latestRequestIdRef.current + 1
		latestRequestIdRef.current = requestId
		setIsLoading(true)
		setError(undefined)
		try {
			const response = await ModelsServiceClient.listProviders(Empty.create())
			if (latestRequestIdRef.current === requestId) {
				setProviders(response.providers)
			}
			return response.providers
		} catch (err) {
			const normalizedError = err instanceof Error ? err : new Error(String(err))
			if (latestRequestIdRef.current === requestId) {
				setError(normalizedError)
			}
			console.error("Failed to list provider catalog entries:", normalizedError)
			return []
		} finally {
			if (latestRequestIdRef.current === requestId) {
				setIsLoading(false)
			}
		}
	}, [])

	useEffect(() => {
		void refresh()
	}, [refresh, remoteConfigKey])

	return { providers, isLoading, error, refresh }
}
