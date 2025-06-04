import { AccountServiceClient } from "@/services/grpc-client"
import { vscode } from "@/utils/vscode"
import { EmptyRequest } from "@shared/proto/common"
import { initializeApp } from "firebase/app"
import { User, getAuth, signInWithCustomToken, signOut } from "firebase/auth"
import React, { createContext, useCallback, useContext, useEffect, useState } from "react"

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

			if (!user) {
				// when opening the extension in a new webview (ie if you logged in to sidebar webview but then open a popout tab webview) this effect will trigger without the original webview's session, resulting in us clearing out the user info object.
				// we rely on this object to determine if the user is logged in, so we only want to clear it when the user logs out, rather than whenever a webview without a session is opened.
				return
			}
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

	// Set up authCallback subscription
	useEffect(() => {
		const cleanup = AccountServiceClient.subscribeToAuthCallback(EmptyRequest.create({}), {
			onResponse: (event) => {
				if (event.value) {
					signInWithToken(event.value)
				}
			},
			onError: (error) => {
				console.error("Error in authCallback subscription:", error)
			},
			onComplete: () => {},
		})

		return cleanup
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
