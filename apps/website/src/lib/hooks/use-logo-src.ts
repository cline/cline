"use client"

import { useTheme } from "next-themes"

export function useLogoSrc(): string {
	const { resolvedTheme } = useTheme()
	return resolvedTheme === "light" ? "/Roo-Code-Logo-Horiz-blk.svg" : "/Roo-Code-Logo-Horiz-white.svg"
}
