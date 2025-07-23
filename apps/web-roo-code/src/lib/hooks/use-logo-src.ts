"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

export function useLogoSrc(): string {
	const { resolvedTheme, theme } = useTheme()
	const [mounted, setMounted] = useState(false)

	// Avoid hydration mismatch by waiting for client-side mount
	useEffect(() => {
		setMounted(true)
	}, [])

	// Before mounting, return a default logo (dark theme as specified in providers)
	// This prevents the logo from flickering on initial load
	if (!mounted) {
		return "/Roo-Code-Logo-Horiz-white.svg"
	}

	// Use theme as fallback if resolvedTheme is not available yet
	const currentTheme = resolvedTheme || theme
	return currentTheme === "light" ? "/Roo-Code-Logo-Horiz-blk.svg" : "/Roo-Code-Logo-Horiz-white.svg"
}
