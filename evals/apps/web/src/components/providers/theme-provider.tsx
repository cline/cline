"use client"

import * as React from "react"
import { type ThemeProviderProps } from "next-themes"
import dynamic from "next/dynamic"

const NextThemesProvider = dynamic(() => import("next-themes").then((e) => e.ThemeProvider), {
	ssr: false,
})

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
	return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
