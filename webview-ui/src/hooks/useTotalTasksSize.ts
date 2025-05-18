import { useEffect, useCallback } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Hook to fetch and update the total tasks size using gRPC directly
 */
export function useTotalTasksSize() {
	const extensionStateContext = useExtensionState()
	const { totalTasksSize } = extensionStateContext

	const fetchTotalTasksSize = useCallback(async () => {
		try {
			const response = await TaskServiceClient.getTotalTasksSize({})
			if (response && typeof response.value === "number") {
				extensionStateContext.setTotalTasksSize?.(response.value || 0)
			}
		} catch (error) {
			console.error("Error getting total tasks size:", error)
		}
	}, [extensionStateContext])

	useEffect(() => {
		fetchTotalTasksSize()
	}, [fetchTotalTasksSize])

	return {
		totalTasksSize,
		fetchTotalTasksSize,
	}
}
