import type { UserOrganization } from "@shared/proto/beadsmith/account"
import type React from "react"
import { createContext, useContext } from "react"

// Define User type (kept for API compatibility but always null)
export interface BeadsmithUser {
	uid: string
	email?: string
	displayName?: string
	photoUrl?: string
	appBaseUrl?: string
}

export interface BeadsmithAuthContextType {
	beadsmithUser: BeadsmithUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
}

export const ClineAuthContext = createContext<BeadsmithAuthContextType | undefined>(undefined)

/**
 * BeadsmithAuthProvider - Simplified provider that always returns null user.
 * Beadsmith integrates with external providers (Claude Code, GitHub Copilot, OpenAI Codex)
 * rather than having its own authentication system.
 */
export const BeadsmithAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return (
		<ClineAuthContext.Provider
			value={{
				beadsmithUser: null,
				organizations: null,
				activeOrganization: null,
			}}>
			{children}
		</ClineAuthContext.Provider>
	)
}

export const useBeadsmithAuth = () => {
	const context = useContext(ClineAuthContext)
	if (context === undefined) {
		throw new Error("useBeadsmithAuth must be used within a BeadsmithAuthProvider")
	}
	return context
}

// Deprecated - kept for API compatibility but does nothing
export const useBeadsmithSignIn = () => {
	return {
		isLoginLoading: false,
		handleSignIn: () => {
			console.log("Beadsmith sign-in is not available. Use external providers instead.")
		},
	}
}

// Deprecated - kept for API compatibility but does nothing
export const handleSignOut = async () => {
	console.log("Beadsmith sign-out is not available. Use external providers instead.")
}
