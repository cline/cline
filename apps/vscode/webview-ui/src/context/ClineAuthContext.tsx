import type { AuthState, UserOrganization } from "@shared/proto/cline/account"
import { EmptyRequest } from "@shared/proto/cline/common"
import deepEqual from "fast-deep-equal"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { AccountServiceClient } from "@/services/grpc-client"

// Define User type (you may need to adjust this based on your actual User type)
export interface ClineUser {
	uid: string
	email?: string
	displayName?: string
	photoUrl?: string
	appBaseUrl?: string
}

export interface ClineAuthContextType {
	clineUser: ClineUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
	accountSwitch: { organizationId: string | undefined; slow: boolean } | null
	accountSwitchError: string | null
	switchOrganization: (organizationId?: string) => Promise<boolean>
}

export const ClineAuthContext = createContext<ClineAuthContextType | undefined>(undefined)

export const ClineAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [user, setUser] = useState<ClineUser | null>(null)
	const [userOrganizations, setUserOrganizations] = useState<UserOrganization[] | null>(null)
	const organizationsRequestIdRef = useRef(0)
	const userIdRef = useRef<string | undefined>(undefined)
	const switchRequestRef = useRef<object | null>(null)
	const [accountSwitch, setAccountSwitch] = useState<ClineAuthContextType["accountSwitch"]>(null)
	const [accountSwitchError, setAccountSwitchError] = useState<string | null>(null)

	// Only the newest read may write context state, but every read returns the
	// server's answer: a switch confirms itself with a read that the switch's
	// own auth-status update can overtake, and that answer is still current.
	const getUserOrganizations = useCallback(async () => {
		const requestId = ++organizationsRequestIdRef.current
		try {
			const response = await AccountServiceClient.getUserOrganizations(EmptyRequest.create())
			if (requestId === organizationsRequestIdRef.current) {
				setUserOrganizations((old) => (deepEqual(response.organizations, old) ? old : response.organizations))
			}
			return response.organizations
		} catch (error) {
			console.error("Failed to fetch user organizations:", error)
			if (requestId === organizationsRequestIdRef.current && switchRequestRef.current) {
				setAccountSwitchError("Could not confirm the active account. Check your connection and reopen Account.")
			}
			return undefined
		}
	}, [])

	// The provider outlives AccountView, including navigation from host-owned
	// toolbar buttons. A switch remains owned until its RPC actually settles.
	const switchOrganization = useCallback(
		async (organizationId?: string) => {
			if (switchRequestRef.current) return false
			const request = {}
			switchRequestRef.current = request
			setAccountSwitch({ organizationId, slow: false })
			setAccountSwitchError(null)
			const timer = setTimeout(() => {
				if (switchRequestRef.current === request) setAccountSwitch({ organizationId, slow: true })
			}, 10_000)
			let succeeded = false
			try {
				await AccountServiceClient.setUserOrganization({ organizationId })
				succeeded = true
			} catch (error) {
				if (switchRequestRef.current === request) {
					setAccountSwitchError(error instanceof Error ? error.message : String(error))
				}
			} finally {
				if (switchRequestRef.current === request) {
					// Failure does not imply rollback: the PUT may have succeeded before
					// auth refresh failed. Re-read the server instead of assuming rollback.
					const organizations = await getUserOrganizations()
					succeeded =
						succeeded &&
						!!organizations &&
						(organizations.find((org) => org.active)?.organizationId ?? undefined) === organizationId
					if (switchRequestRef.current === request) {
						switchRequestRef.current = null
						setAccountSwitch(null)
					} else {
						succeeded = false
					}
				} else {
					succeeded = false
				}
				clearTimeout(timer)
			}
			return succeeded
		},
		[getUserOrganizations],
	)

	const activeOrganization = useMemo(() => {
		return userOrganizations?.find((org) => org.active) ?? null
	}, [userOrganizations])

	useEffect(() => {
		console.log("Extension: ClineAuthContext: user updated:", user?.uid)
	}, [user?.uid])

	// Handle auth status update events
	useEffect(() => {
		const cancelSubscription = AccountServiceClient.subscribeToAuthStatusUpdate(EmptyRequest.create(), {
			onResponse: (response: AuthState) => {
				const responseUser = response.user
				if (userIdRef.current !== responseUser?.uid) {
					userIdRef.current = responseUser?.uid
					switchRequestRef.current = null
					setAccountSwitch(null)
					setAccountSwitchError(null)
					setUserOrganizations(null)
				}
				if (!responseUser?.uid) {
					organizationsRequestIdRef.current++
					switchRequestRef.current = null
					setAccountSwitch(null)
					setAccountSwitchError(null)
					setUser(null)
					setUserOrganizations(null)
					return
				}

				// Refresh organizations on every auth status update, not just user
				// changes. Switching organizations doesn't change the uid, so gating
				// this on uid changes leaves stale `active` flags — which reset the
				// account view's org dropdown on remount. The deepEqual guard in
				// getUserOrganizations prevents no-op re-renders.
				getUserOrganizations()

				setUser((oldUser) => (oldUser?.uid !== responseUser.uid ? responseUser : oldUser))
			},
			onError: (error: Error) => {
				console.error("Error in auth callback subscription:", error)
			},
			onComplete: () => {
				console.log("Auth callback subscription completed")
			},
		})

		// Cleanup function to cancel subscription when component unmounts
		return () => {
			organizationsRequestIdRef.current++
			switchRequestRef.current = null
			cancelSubscription()
		}
	}, [getUserOrganizations])

	return (
		<ClineAuthContext.Provider
			value={{
				clineUser: user,
				organizations: userOrganizations,
				activeOrganization,
				accountSwitch,
				accountSwitchError,
				switchOrganization,
			}}>
			{children}
		</ClineAuthContext.Provider>
	)
}

export const useClineAuth = () => {
	const context = useContext(ClineAuthContext)
	if (context === undefined) {
		throw new Error("useClineAuth must be used within a ClineAuthProvider")
	}
	return context
}

export const useClineSignIn = () => {
	const [isLoading, setIsLoading] = useState(false)
	const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(null)

	const handleSignIn = useCallback(() => {
		try {
			setIsLoading(true)
			setAuthStatusMessage(null)

			AccountServiceClient.accountLoginClicked(EmptyRequest.create())
				.then((response) => {
					setAuthStatusMessage(response.value || "Complete sign-in in your browser.")
				})
				.catch((err) => {
					console.error("Failed to start login:", err)
					setAuthStatusMessage("Unable to start sign-in. Please try again.")
				})
				.finally(() => {
					setIsLoading(false)
				})
		} catch (error) {
			console.error("Error signing in:", error)
			setAuthStatusMessage("Unable to start sign-in. Please try again.")
			setIsLoading(false)
		}
	}, [])

	return {
		isLoginLoading: isLoading,
		authStatusMessage,
		handleSignIn,
	}
}

export const handleSignOut = async () => {
	try {
		await AccountServiceClient.accountLogoutClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to logout:", err),
		)
	} catch (error) {
		console.error("Error signing out:", error)
		throw error
	}
}
