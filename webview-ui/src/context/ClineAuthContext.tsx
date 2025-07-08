import { AccountServiceClient } from "@/services/grpc-client"
import { EmptyRequest } from "@shared/proto/common"
import React, { createContext, useCallback, useContext, useEffect, useState } from "react"

// Define User type (you may need to adjust this based on your actual User type)
export interface ClineUser {
	uid: string
	email?: string
	displayName?: string
	photoUrl?: string
}

export interface ClineAuthContextType {
	clineUser: ClineUser | null
	handleSignIn: () => Promise<void>
	handleSignOut: () => Promise<void>
}

const ClineAuthContext = createContext<ClineAuthContextType | undefined>(undefined)

export const ClineAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [user, setUser] = useState<ClineUser | null>(null)

	useEffect(() => {
		console.log("Extension: ClineAuthContext: user updated:", user)
	}, [user])

	// Handle auth status update events
	useEffect(() => {
		const cancelSubscription = AccountServiceClient.subscribeToAuthStatusUpdate(EmptyRequest.create(), {
			onResponse: async (response: any) => {
				console.log("Extension: ClineAuthContext: Received auth status update:", response)
				if (response && response.user) {
					setUser(response.user)
				}
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
			cancelSubscription()
		}
	}, [])

	const handleSignIn = useCallback(async () => {
		try {
			AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
				console.error("Failed to get login URL:", err),
			)
		} catch (error) {
			console.error("Error signing in:", error)
			throw error
		}
	}, [])

	const handleSignOut = useCallback(async () => {
		try {
			await AccountServiceClient.accountLogoutClicked(EmptyRequest.create()).catch((err) =>
				console.error("Failed to logout:", err),
			)
		} catch (error) {
			console.error("Error signing out:", error)
			throw error
		}
	}, [])

	return (
		<ClineAuthContext.Provider value={{ clineUser: user, handleSignIn, handleSignOut }}>{children}</ClineAuthContext.Provider>
	)
}

export const useClineAuth = () => {
	const context = useContext(ClineAuthContext)
	if (context === undefined) {
		throw new Error("useClineAuth must be used within a ClineAuthProvider")
	}
	return context
}
