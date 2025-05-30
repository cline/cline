"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"

import { PostHogProvider } from "./posthog-provider"

const queryClient = new QueryClient()

export const Providers = ({ children }: { children: React.ReactNode }) => {
	return (
		<QueryClientProvider client={queryClient}>
			<PostHogProvider>
				<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
					{children}
				</ThemeProvider>
			</PostHogProvider>
		</QueryClientProvider>
	)
}
