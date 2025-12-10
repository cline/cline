import { EmptyRequest } from "@shared/proto/index.cline"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { handleSignOut, useClineAuth, useClineSignIn } from "@/context/ClineAuthContext"
import { AccountServiceClient } from "@/services/grpc-client"

function LoadingSpinner() {
	return (
		<span className="ml-1 animate-spin">
			<span className="codicon codicon-refresh"></span>
		</span>
	)
}

type ClineAuthStatusProps = {
	authButtonText?: string
}

export function ClineAuthStatus({ authButtonText = "Sign in to Cline" }: ClineAuthStatusProps) {
	const { isAuthenticated, isLoading, error, nextRetryAt } = useClineAuth()
	const { isLoginLoading, handleSignIn } = useClineSignIn()
	const [isFetching, setIsFetching] = useState(false)
	const [secondsUntilNextRetry, setSecondsUntilNextRetry] = useState<number | null>(null)

	useEffect(() => {
		const timeUntilNextRetry = nextRetryAt && Math.ceil((nextRetryAt - Date.now()) / 1000)
		if (timeUntilNextRetry) {
			setSecondsUntilNextRetry(timeUntilNextRetry)

			const intervalId = setInterval(() => {
				setSecondsUntilNextRetry((old) => {
					if (!old || old < 1) {
						clearInterval(intervalId)
						return null
					}

					return old - 1
				})
			}, 1000)

			return () => clearInterval(intervalId)
		}
	}, [nextRetryAt])

	const hasValidAuthSession = isAuthenticated && !error && !isLoading

	/* The user is signed in or not using cline provider */
	if (hasValidAuthSession) {
		return null
	}

	if (error || isLoading) {
		const onFetchAuth = () => {
			try {
				setIsFetching(true)

				AccountServiceClient.fetchAuth(EmptyRequest.create())
					.catch((err) => {
						console.error("Failed to fetch auth:", err)
					})
					.finally(() => {
						setIsFetching(false)
					})
			} catch (error) {
				console.error("Error signing in:", error)
			}
		}

		return (
			<div className="flex flex-col gap-2 w-full">
				{error ? (
					<span>
						{error} {secondsUntilNextRetry && `Please retry in ${secondsUntilNextRetry} seconds.`}
					</span>
				) : (
					isLoading && <span>We're fetching your information. Please wait or force a retry.</span>
				)}

				<div className="flex gap-4 w-full">
					<VSCodeButton appearance="secondary" className="flex-1" onClick={() => handleSignOut()}>
						Log out
					</VSCodeButton>
					<VSCodeButton
						className="flex-1"
						disabled={isFetching || (!!nextRetryAt && nextRetryAt > Date.now())}
						onClick={onFetchAuth}>
						Retry
						{isFetching && <LoadingSpinner />}
					</VSCodeButton>
				</div>
			</div>
		)
	}

	return (
		<VSCodeButton className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
			{authButtonText}
			{isLoginLoading && <LoadingSpinner />}
		</VSCodeButton>
	)
}
