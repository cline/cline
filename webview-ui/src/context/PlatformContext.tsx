import React, { createContext, useContext } from "react"
import type { PlatformConfig } from "../config/platform.config"
import { PLATFORM_CONFIG } from "../config/platform.config"

const PlatformContext = createContext<PlatformConfig>(PLATFORM_CONFIG)

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return <PlatformContext.Provider value={PLATFORM_CONFIG}>{children}</PlatformContext.Provider>
}

export const usePlatform = () => {
	return useContext(PlatformContext)
}

// Optional convenience hooks for individual config values
export const useShowNavbar = () => usePlatform().showNavbar
