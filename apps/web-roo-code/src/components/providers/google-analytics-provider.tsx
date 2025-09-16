"use client"

import { useEffect, useState } from "react"
import Script from "next/script"
import { hasConsent, onConsentChange } from "@/lib/analytics/consent-manager"

// Google Tag Manager ID
const GTM_ID = "AW-17391954825"

/**
 * Google Analytics Provider
 * Only loads Google Tag Manager after user gives consent
 */
export function GoogleAnalyticsProvider({ children }: { children: React.ReactNode }) {
	const [shouldLoad, setShouldLoad] = useState(false)

	useEffect(() => {
		// Check initial consent status
		if (hasConsent()) {
			setShouldLoad(true)
			initializeGoogleAnalytics()
		}

		// Listen for consent changes
		const unsubscribe = onConsentChange((consented) => {
			if (consented && !shouldLoad) {
				setShouldLoad(true)
				initializeGoogleAnalytics()
			}
		})

		return unsubscribe
	}, [shouldLoad])

	const initializeGoogleAnalytics = () => {
		// Initialize the dataLayer and gtag function
		if (typeof window !== "undefined") {
			window.dataLayer = window.dataLayer || []
			window.gtag = function (...args: GtagArgs) {
				window.dataLayer.push(args)
			}
			window.gtag("js", new Date())
			window.gtag("config", GTM_ID)
		}
	}

	// Only render Google Analytics scripts if consent is given
	if (!shouldLoad) {
		return <>{children}</>
	}

	return (
		<>
			{/* Google tag (gtag.js) - Only loads after consent */}
			<Script
				src={`https://www.googletagmanager.com/gtag/js?id=${GTM_ID}`}
				strategy="afterInteractive"
				onLoad={() => {
					console.log("Google Analytics loaded with consent")
				}}
			/>
			<Script id="google-analytics-init" strategy="afterInteractive">
				{`
					window.dataLayer = window.dataLayer || [];
					function gtag(){dataLayer.push(arguments);}
					gtag('js', new Date());
					gtag('config', '${GTM_ID}');
				`}
			</Script>
			{children}
		</>
	)
}

// Type definitions for Google Analytics
type GtagArgs = ["js", Date] | ["config", string, GtagConfig?] | ["event", string, GtagEventParameters?]

interface GtagConfig {
	[key: string]: unknown
}

interface GtagEventParameters {
	[key: string]: unknown
}

// Declare global types for TypeScript
declare global {
	interface Window {
		dataLayer: GtagArgs[]
		gtag: (...args: GtagArgs) => void
	}
}
