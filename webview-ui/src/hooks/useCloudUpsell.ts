import { useState, useCallback, useRef, useEffect } from "react"
import { TelemetryEventName } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { telemetryClient } from "@/utils/TelemetryClient"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface UseCloudUpsellOptions {
	onAuthSuccess?: () => void
	autoOpenOnAuth?: boolean
}

export const useCloudUpsell = (options: UseCloudUpsellOptions = {}) => {
	const { onAuthSuccess, autoOpenOnAuth = false } = options
	const [isOpen, setIsOpen] = useState(false)
	const [shouldOpenOnAuth, setShouldOpenOnAuth] = useState(false)
	const { cloudIsAuthenticated, sharingEnabled } = useExtensionState()
	const wasUnauthenticatedRef = useRef(false)
	const initiatedAuthRef = useRef(false)

	// Track authentication state changes
	useEffect(() => {
		if (!cloudIsAuthenticated || !sharingEnabled) {
			wasUnauthenticatedRef.current = true
		} else if (wasUnauthenticatedRef.current && cloudIsAuthenticated && sharingEnabled) {
			// User just authenticated
			if (initiatedAuthRef.current) {
				// Auth was initiated from this hook
				telemetryClient.capture(TelemetryEventName.ACCOUNT_CONNECT_SUCCESS)
				setIsOpen(false) // Close the upsell dialog

				if (autoOpenOnAuth && shouldOpenOnAuth) {
					onAuthSuccess?.()
					setShouldOpenOnAuth(false)
				}

				initiatedAuthRef.current = false // Reset the flag
			}
			wasUnauthenticatedRef.current = false
		}
	}, [cloudIsAuthenticated, sharingEnabled, onAuthSuccess, autoOpenOnAuth, shouldOpenOnAuth])

	const openUpsell = useCallback(() => {
		setIsOpen(true)
	}, [])

	const closeUpsell = useCallback(() => {
		setIsOpen(false)
		setShouldOpenOnAuth(false)
	}, [])

	const handleConnect = useCallback(() => {
		// Mark that authentication was initiated from this hook
		initiatedAuthRef.current = true
		setShouldOpenOnAuth(true)

		// Send message to VS Code to initiate sign in
		vscode.postMessage({ type: "rooCloudSignIn" })

		// Close the upsell dialog
		closeUpsell()
	}, [closeUpsell])

	return {
		isOpen,
		openUpsell,
		closeUpsell,
		handleConnect,
		isAuthenticated: cloudIsAuthenticated,
		sharingEnabled,
	}
}
