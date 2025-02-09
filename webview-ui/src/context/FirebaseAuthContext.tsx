import { User, getAuth, signInWithCustomToken, signOut } from "firebase/auth"
import { initializeApp } from "firebase/app"
import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { vscode } from "../utils/vscode"

// Firebase configuration from extension
const firebaseConfig = {
	apiKey: "AIzaSyDcXAaanNgR2_T0dq2oOl5XyKPksYHppVo",
	authDomain: "cline-bot.firebaseapp.com",
	projectId: "cline-bot",
	storageBucket: "cline-bot.firebasestorage.app",
	messagingSenderId: "364369702101",
	appId: "1:364369702101:web:0013885dcf20b43799c65c",
	measurementId: "G-MDPRELSCD1",
}

interface FirebaseAuthContextType {
	user: User | null
	isInitialized: boolean
	signInWithToken: (token: string) => Promise<void>
	handleSignOut: () => Promise<void>
}

const FirebaseAuthContext = createContext<FirebaseAuthContextType | undefined>(undefined)

export const FirebaseAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [user, setUser] = useState<User | null>(null)
	const [isInitialized, setIsInitialized] = useState(false)

	// Initialize Firebase
	const app = initializeApp(firebaseConfig)
	const auth = getAuth(app)

	// Handle auth state changes
	useEffect(() => {
		const unsubscribe = auth.onAuthStateChanged((user) => {
			setUser(user)
			setIsInitialized(true)

			// Sync auth state with extension
			vscode.postMessage({
				type: "authStateChanged",
				user: user
					? {
							displayName: user.displayName,
							email: user.email,
							photoURL: user.photoURL,
						}
					: null,
			})
		})

		return () => unsubscribe()
	}, [auth])

	const signInWithToken = useCallback(
		async (token: string) => {
			try {
				await signInWithCustomToken(auth, token)
				console.log("Successfully signed in with custom token")
			} catch (error) {
				console.error("Error signing in with custom token:", error)
				throw error
			}
		},
		[auth],
	)

	// Listen for auth callback from extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "authCallback" && message.customToken) {
				signInWithToken(message.customToken)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [signInWithToken])

	const handleSignOut = useCallback(async () => {
		try {
			await signOut(auth)
			console.log("Successfully signed out of Firebase")
		} catch (error) {
			console.error("Error signing out of Firebase:", error)
			throw error
		}
	}, [auth])

	return (
		<FirebaseAuthContext.Provider value={{ user, isInitialized, signInWithToken, handleSignOut }}>
			{children}
		</FirebaseAuthContext.Provider>
	)
}

export const useFirebaseAuth = () => {
	const context = useContext(FirebaseAuthContext)
	if (context === undefined) {
		throw new Error("useFirebaseAuth must be used within a FirebaseAuthProvider")
	}
	return context
}
