import { type GitHubConnection, GitHubConnectionRequest } from "@shared/proto/cline/cloud"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useClineAuth } from "@/context/ClineAuthContext"
import { CloudServiceClient } from "@/services/grpc-client"

const DISCONNECTED_POLL_MS = 6_000

/**
 * GitHub App connection status for cloud sessions. The connection belongs to
 * the active account (personal or organization), so it is re-read whenever
 * that changes. While the user is signed in but GitHub is not connected (or
 * grants no repositories), the status is re-checked periodically and on window
 * focus so finishing the connect flow in the browser flips the UI on its own.
 */
export function useGitHubConnection(enabled: boolean) {
	const { clineUser, activeOrganization, accountSwitch } = useClineAuth()
	const available = enabled && !!clineUser?.uid && !accountSwitch
	const scope = useMemo(
		() => ({ available, userId: clineUser?.uid, organizationId: activeOrganization?.organizationId }),
		[available, clineUser?.uid, activeOrganization?.organizationId],
	)
	const [snapshot, setSnapshot] = useState<{ scope: object; connection: GitHubConnection }>()
	const connection = available && snapshot?.scope === scope ? snapshot.connection : undefined
	const [loading, setLoading] = useState(false)
	const inFlight = useRef<{ scope: object; promise: Promise<void> } | undefined>(undefined)

	const load = useCallback(
		async (refresh: boolean) => {
			if (!available) {
				return
			}
			if (inFlight.current?.scope === scope) {
				return inFlight.current.promise
			}
			setLoading(true)
			const request = {
				scope,
				promise: CloudServiceClient.getGitHubConnection(GitHubConnectionRequest.create({ refresh }))
					.then((result) => {
						// A response for a previous account must not describe the current one.
						if (inFlight.current === request) setSnapshot({ scope, connection: result })
					})
					.catch((error) => {
						if (inFlight.current !== request) return
						console.error("Failed to load GitHub connection:", error)
						setSnapshot({
							scope,
							connection: {
								signedIn: true,
								connected: false,
								connectUrl: "",
								repositories: [],
								error: error instanceof Error ? error.message : String(error),
							},
						})
					})
					.finally(() => {
						if (inFlight.current === request) {
							setLoading(false)
							inFlight.current = undefined
						}
					}),
			}
			inFlight.current = request
			return request.promise
		},
		[available, scope],
	)

	// The extension caches the connection per account, so a first read after
	// mounting or an account change is cheap; only the user's Refresh and the
	// not-yet-connected poll ask the control plane again.
	useEffect(() => {
		setLoading(false)
		void load(false)
		return () => {
			inFlight.current = undefined
		}
	}, [load])
	const refresh = useCallback(() => load(true), [load])

	const needsPolling =
		available &&
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
