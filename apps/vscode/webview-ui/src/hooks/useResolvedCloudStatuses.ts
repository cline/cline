import { CloudSessionStatusRequest } from "@shared/proto/cline/cloud"
import { useEffect, useState } from "react"
import { CloudServiceClient } from "@/services/grpc-client"

const STATUS_RETRY_MS = 30_000

interface CloudStatusTask {
	id: string
	executionTarget?: string
	cloudStatus?: string
}

export function useResolvedCloudStatuses(tasks: CloudStatusTask[]): ReadonlyMap<string, string> {
	const [resolved, setResolved] = useState<ReadonlyMap<string, string>>(() => new Map())
	const [retry, setRetry] = useState(0)
	const unknownIds = tasks
		.filter((task) => task.executionTarget === "cloud" && task.cloudStatus === "unknown")
		.map((task) => task.id)
		.join("\n")

	useEffect(() => {
		if (!unknownIds) return
		let disposed = false
		let retryTimer: ReturnType<typeof setTimeout> | undefined
		const scheduleRetry = () => {
			retryTimer = setTimeout(() => setRetry((value) => value + 1), STATUS_RETRY_MS)
		}
		CloudServiceClient.resolveCloudSessionStatuses(CloudSessionStatusRequest.create({ sessionIds: unknownIds.split("\n") }))
			.then((response) => {
				if (disposed) return
				setResolved(new Map(response.statuses.map((item) => [item.sessionId, item.status])))
				if (response.statuses.some((item) => item.status === "unknown")) scheduleRetry()
			})
			.catch((error) => {
				console.error("Failed to resolve cloud session status:", error)
				if (!disposed) scheduleRetry()
			})
		return () => {
			disposed = true
			clearTimeout(retryTimer)
		}
	}, [retry, unknownIds])
	return resolved
}
