import { useCallback, useState, useEffect } from "react"
import { useExtensionState } from "../context/ExtensionStateContext"
import { initiateCursorAuth, refreshCursorToken, type CursorAuthError } from "../utils/cursor/auth"
import { vscode } from "../utils/vscode"

interface UseCursorAuthReturn {
	isAuthenticated: boolean
	isAuthenticating: boolean
	handleLogin: () => Promise<void>
	handleLogout: () => void
	error: string | null
}

export function useCursorAuth(): UseCursorAuthReturn {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()
	const [isAuthenticating, setIsAuthenticating] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const isAuthenticated = !!apiConfiguration?.cursorAccessToken

	const handleLogin = useCallback(async () => {
		try {
			setError(null)
			setIsAuthenticating(true)
			await initiateCursorAuth(
				(accessToken, refreshToken) => {
					setApiConfiguration({
						...apiConfiguration,
						apiProvider: "cursor",
						cursorAccessToken: accessToken,
						cursorRefreshToken: refreshToken,
						cursorTokenExpiry: Date.now() + 3600000, // 1 hour
					})
					setIsAuthenticating(false)
				},
				(error: CursorAuthError) => {
					setIsAuthenticating(false)
					setError(error.message)
					vscode.postMessage({
						type: "cursorAuthError",
						error: error.message,
					})
				},
			)
		} catch (error) {
			setIsAuthenticating(false)
			const errorMessage = error instanceof Error ? error.message : "Authentication failed"
			setError(errorMessage)
			vscode.postMessage({
				type: "cursorAuthError",
				error: errorMessage,
			})
		}
	}, [apiConfiguration, setApiConfiguration])

	const handleLogout = useCallback(() => {
		setApiConfiguration({
			...apiConfiguration,
			cursorAccessToken: undefined,
			cursorRefreshToken: undefined,
			cursorTokenExpiry: undefined,
		})
		vscode.postMessage({
			type: "clearCursorTokens",
		})
		setError(null)
	}, [apiConfiguration, setApiConfiguration])

	// Auto refresh token when it's about to expire
	useEffect(() => {
		if (!isAuthenticated || !apiConfiguration?.cursorRefreshToken || !apiConfiguration?.cursorTokenExpiry) {
			return
		}

		const timeUntilExpiry = apiConfiguration.cursorTokenExpiry - Date.now()
		if (timeUntilExpiry <= 300000) {
			// Refresh if less than 5 minutes until expiry
			refreshCursorToken(apiConfiguration.cursorRefreshToken)
				.then(({ access_token }) => {
					setApiConfiguration({
						...apiConfiguration,
						cursorAccessToken: access_token,
						cursorTokenExpiry: Date.now() + 3600000, // 1 hour
					})
				})
				.catch((error: CursorAuthError) => {
					if (error.type === "auth_error") {
						handleLogout()
					}
					setError(error.message)
					vscode.postMessage({
						type: "cursorAuthError",
						error: error.message,
					})
				})
		}
	}, [apiConfiguration, isAuthenticated, handleLogout, setApiConfiguration])

	return {
		isAuthenticated,
		isAuthenticating,
		handleLogin,
		handleLogout,
		error,
	}
}
