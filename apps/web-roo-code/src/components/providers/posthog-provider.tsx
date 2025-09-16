"use client"

import { usePathname, useSearchParams } from "next/navigation"
import posthog from "posthog-js"
import { PostHogProvider as OriginalPostHogProvider } from "posthog-js/react"
import { useEffect, Suspense, useState } from "react"
import { hasConsent, onConsentChange } from "@/lib/analytics/consent-manager"

function PageViewTracker() {
	const pathname = usePathname()
	const searchParams = useSearchParams()

	// Track page views
	useEffect(() => {
		if (pathname && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
			let url = window.location.origin + pathname
			if (searchParams && searchParams.toString()) {
				url = url + `?${searchParams.toString()}`
			}
			posthog.capture("$pageview", {
				$current_url: url,
			})
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pathname, searchParams.toString()])

	return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
	const [isInitialized, setIsInitialized] = useState(false)

	useEffect(() => {
		// Initialize PostHog only on the client side AND when consent is given
		if (typeof window !== "undefined") {
			const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
			const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

			// Check if environment variables are set
			if (!posthogKey) {
				console.warn(
					"PostHog API key is missing. Analytics will be disabled. " +
						"Please set NEXT_PUBLIC_POSTHOG_KEY in your .env file.",
				)
				return
			}

			if (!posthogHost) {
				console.warn(
					"PostHog host URL is missing. Using default host. " +
						"Please set NEXT_PUBLIC_POSTHOG_HOST in your .env file.",
				)
			}

			const initializePosthog = () => {
				if (!isInitialized) {
					posthog.init(posthogKey, {
						api_host: posthogHost || "https://us.i.posthog.com",
						capture_pageview: false,
						loaded: (posthogInstance) => {
							if (process.env.NODE_ENV === "development") {
								posthogInstance.debug()
							}
						},
						respect_dnt: true, // Respect Do Not Track
					})
					setIsInitialized(true)
				}
			}

			// Check initial consent status
			if (hasConsent()) {
				initializePosthog()
			}

			// Listen for consent changes
			const unsubscribe = onConsentChange((consented) => {
				if (consented && !isInitialized) {
					initializePosthog()
				}
			})

			return () => {
				unsubscribe()
			}
		}
	}, [isInitialized])

	// Only provide PostHog context if it's initialized
	return (
		<OriginalPostHogProvider client={posthog}>
			{isInitialized && (
				<Suspense fallback={null}>
					<PageViewTracker />
				</Suspense>
			)}
			{children}
		</OriginalPostHogProvider>
	)
}
