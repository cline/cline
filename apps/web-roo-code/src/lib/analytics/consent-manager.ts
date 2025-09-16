/**
 * Simple consent event system
 * Dispatches events when cookie consent changes
 */

import { getCookieConsentValue } from "react-cookie-consent"
import { CONSENT_COOKIE_NAME } from "@roo-code/types"

export const CONSENT_EVENT = "cookieConsentChanged"

/**
 * Check if user has given consent for analytics cookies
 * Uses react-cookie-consent's built-in function
 */
export function hasConsent(): boolean {
	if (typeof window === "undefined") return false
	return getCookieConsentValue(CONSENT_COOKIE_NAME) === "true"
}

/**
 * Dispatch a consent change event
 */
export function dispatchConsentEvent(consented: boolean): void {
	if (typeof window !== "undefined") {
		const event = new CustomEvent(CONSENT_EVENT, {
			detail: { consented },
		})
		window.dispatchEvent(event)
	}
}

/**
 * Listen for consent changes
 */
export function onConsentChange(callback: (consented: boolean) => void): () => void {
	if (typeof window === "undefined") {
		return () => {}
	}

	const handler = (event: Event) => {
		const customEvent = event as CustomEvent<{ consented: boolean }>
		callback(customEvent.detail.consented)
	}

	window.addEventListener(CONSENT_EVENT, handler)
	return () => window.removeEventListener(CONSENT_EVENT, handler)
}
