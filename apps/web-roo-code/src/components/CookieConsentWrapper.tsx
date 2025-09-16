"use client"

import React, { useState, useEffect } from "react"
import ReactCookieConsent from "react-cookie-consent"
import { Cookie } from "lucide-react"
import { getDomain } from "tldts"
import { CONSENT_COOKIE_NAME } from "@roo-code/types"
import { dispatchConsentEvent } from "@/lib/analytics/consent-manager"

/**
 * GDPR-compliant cookie consent banner component
 * Handles both the UI and consent event dispatching
 */
export function CookieConsentWrapper() {
	const [cookieDomain, setCookieDomain] = useState<string | null>(null)

	useEffect(() => {
		// Get the appropriate domain using tldts
		if (typeof window !== "undefined") {
			const domain = getDomain(window.location.hostname)
			setCookieDomain(domain)
		}
	}, [])

	const handleAccept = () => {
		dispatchConsentEvent(true)
	}

	const handleDecline = () => {
		dispatchConsentEvent(false)
	}

	const extraCookieOptions = cookieDomain
		? {
				domain: cookieDomain,
			}
		: {}

	const containerClasses = `
		fixed bottom-2 left-2 right-2 z-[999]
		bg-black/95 dark:bg-white/95
		text-white dark:text-black
		border-t-neutral-800 dark:border-t-gray-200
		backdrop-blur-xl
		border-t
		font-semibold
		rounded-t-lg
		px-4 py-4 md:px-8 md:py-4
		flex flex-wrap items-center justify-between gap-4
		text-sm font-sans
	`.trim()

	const buttonWrapperClasses = `
		flex
		flex-row-reverse
		items-center
		gap-2
	`.trim()

	const acceptButtonClasses = `
		bg-white text-black border-neutral-800
		dark:bg-black dark:text-white dark:border-gray-200
		hover:opacity-50
		transition-opacity
		rounded-md
		px-4 py-2 mr-2
		text-sm font-bold
		cursor-pointer
		focus:outline-none focus:ring-2 focus:ring-offset-2
	`.trim()

	const declineButtonClasses = `
		dark:bg-white dark:text-black dark:border-gray-200
		bg-black text-white border-neutral-800
		hover:opacity-50
		border border-border
		transition-opacity
		rounded-md
		px-4 py-2
		text-sm font-bold
		cursor-pointer
		focus:outline-none focus:ring-2 focus:ring-offset-2
	`.trim()

	return (
		<div role="banner" aria-label="Cookie consent banner" aria-live="polite">
			<ReactCookieConsent
				location="bottom"
				buttonText="Accept"
				declineButtonText="Decline"
				cookieName={CONSENT_COOKIE_NAME}
				expires={365}
				enableDeclineButton={true}
				onAccept={handleAccept}
				onDecline={handleDecline}
				containerClasses={containerClasses}
				buttonClasses={acceptButtonClasses}
				buttonWrapperClasses={buttonWrapperClasses}
				declineButtonClasses={declineButtonClasses}
				extraCookieOptions={extraCookieOptions}
				disableStyles={true}
				ariaAcceptLabel={`Accept`}
				ariaDeclineLabel={`Decline`}>
				<div className="flex items-center gap-2">
					<Cookie className="size-5 hidden md:block" />
					<span>Like most of the internet, we use cookies. Are you OK with that?</span>
				</div>
			</ReactCookieConsent>
		</div>
	)
}
