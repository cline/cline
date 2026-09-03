import type { GitHubConnection } from "@shared/proto/cline/cloud"
import { EmptyRequest } from "@shared/proto/cline/common"
import { useCallback, useEffect, useRef, useState } from "react"
import { CloudServiceClient } from "@/services/grpc-client"

const DISCONNECTED_POLL_MS = 6_000

/**
 * GitHub App connection status for cloud sessions. While the user is signed in
 * but GitHub is not connected (or grants no repositories), the status is
 * re-checked periodically and on window focus so finishing the connect flow in
 * the browser flips the UI on its own.
 */
export function useGitHubConnection(enabled: boolean) {
	const [connection, setConnection] = useState<GitHubConnection | undefined>()
	const [loading, setLoading] = useState(false)
	const inFlight = useRef<Promise<void> | undefined>(undefined)

	const refresh = useCallback(async () => {
		if (!enabled) {
			return
		}
		if (inFlight.current) {
			return inFlight.current
		}
		setLoading(true)
		inFlight.current = CloudServiceClient.getGitHubConnection(EmptyRequest.create())
			.then((result) => setConnection(result))
			.catch((error) => {
				console.error("Failed to load GitHub connection:", error)
				setConnection((previous) => ({
					signedIn: previous?.signedIn ?? true,
					connected: false,
					connectUrl: previous?.connectUrl ?? "",
					repositories: [],
					error: error instanceof Error ? error.message : String(error),
				}))
			})
			.finally(() => {
				setLoading(false)
				inFlight.current = undefined
			})
		return inFlight.current
	}, [enabled])

	useEffect(() => {
		if (!enabled) {
			return
		}
		void refresh()
	}, [enabled, refresh])

	const needsPolling =
		enabled &&
		!!connection &&
		connection.signedIn &&
		(!connection.connected || connection.repositories.length === 0) &&
		!connection.error
	useEffect(() => {
		if (!needsPolling) {
			return
		}
		const timer = setInterval(() => void refresh(), DISCONNECTED_POLL_MS)
		const onFocus = () => void refresh()
		window.addEventListener("focus", onFocus)
		return () => {
			clearInterval(timer)
			window.removeEventListener("focus", onFocus)
		}
	}, [needsPolling, refresh])

	return { connection, loading, refresh }
}
