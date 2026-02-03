/**
 * Context for tracking stdin raw mode support
 * Used to conditionally disable input handling when stdin doesn't support raw mode
 * (e.g., when input is piped: echo "..." | clinedev)
 */

import React, { createContext, type ReactNode, useContext } from "react"

interface StdinContextValue {
	/**
	 * Whether stdin supports raw mode (keyboard input handling)
	 * Will be false when input is piped or stdin is not a TTY
	 */
	isRawModeSupported: boolean
}

const StdinContext = createContext<StdinContextValue>({ isRawModeSupported: true })

export const useStdinContext = () => useContext(StdinContext)

interface StdinProviderProps {
	children: ReactNode
	isRawModeSupported: boolean
}

export const StdinProvider: React.FC<StdinProviderProps> = ({ children, isRawModeSupported }) => {
	return <StdinContext.Provider value={{ isRawModeSupported }}>{children}</StdinContext.Provider>
}

/**
 * Check if stdin supports raw mode
 * Returns false when input is piped or stdin is not a TTY
 */
export function checkRawModeSupport(): boolean {
	return Boolean(process.stdin.isTTY && typeof process.stdin.setRawMode === "function")
}
