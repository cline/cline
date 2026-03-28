/**
 * Hook for OCA OAuth authentication flow in the CLI.
 * Handles starting auth, subscribing to status updates, and notifying on success.
 */

import type { OcaAuthState } from "@shared/proto/cline/oca_account"
import { useCallback, useEffect, useRef, useState } from "react"
import type { Controller } from "@/core/controller"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"

interface UseOcaAuthOptions {
	controller: Controller | undefined
	/** If provided, controls when subscription is active (for external state management like AuthView's step) */
	enabled?: boolean
	onSuccess?: () => void | Promise<void>
	onError?: (error: Error) => void
}

interface UseOcaAuthResult {
	/** Whether we're waiting for auth to complete (only relevant when not using `enabled` prop) */
	isWaiting: boolean
	/** Start the OAuth flow - opens browser */
	startAuth: () => void
	/** Cancel waiting for auth */
	cancelAuth: () => void
	/** The authenticated user, if any */
	user: OcaAuthState["user"] | null
	/** Whether user is currently authenticated */
	isAuthenticated: boolean
}

export function useOcaAuth({ controller, enabled, onSuccess, onError }: UseOcaAuthOptions): UseOcaAuthResult {
	const [isWaiting, setIsWaiting] = useState(false)
	const [user, setUser] = useState<OcaAuthState["user"] | null>(null)
	const onSuccessRef = useRef(onSuccess)
	onSuccessRef.current = onSuccess

	// Determine if subscription should be active
	// If `enabled` is provided, use it; otherwise use internal `isWaiting` state
	const isSubscriptionActive = enabled !== undefined ? enabled : isWaiting

	const startAuth = useCallback(() => {
		if (!controller) {
			return
		}
		setIsWaiting(true)
		OcaAuthService.initialize(controller)
		OcaAuthService.getInstance()
			.createAuthRequest()
			.catch((error) => {
				setIsWaiting(false)
				onError?.(error instanceof Error ? error : new Error(String(error)))
			})
	}, [controller, onError])

	const cancelAuth = useCallback(() => {
		setIsWaiting(false)
	}, [])

	// Check if already authenticated
	const isAuthenticated = !!user?.uid

	// Subscribe to auth status updates when active
	useEffect(() => {
		if (!isSubscriptionActive || !controller) {
			return
		}

		let cancelled = false

		const responseHandler = async (authState: OcaAuthState) => {
			if (cancelled) {
				return
			}
			if (authState.user?.uid) {
				setUser(authState.user)
				setIsWaiting(false)
				await onSuccessRef.current?.()
			}
		}

		// Ensure OcaAuthService is initialized before subscribing
		OcaAuthService.initialize(controller)
		OcaAuthService.getInstance().subscribeToAuthStatusUpdate({}, responseHandler, `cli-oca-auth-${Date.now()}`)

		return () => {
			cancelled = true
		}
	}, [isSubscriptionActive, controller])

	return { isWaiting, startAuth, cancelAuth, user, isAuthenticated }
}
