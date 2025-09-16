/**
 * Cookie consent constants and types
 * Shared across all Roo Code repositories
 */

/**
 * The name of the cookie that stores user's consent preference
 * Used by react-cookie-consent library
 */
export const CONSENT_COOKIE_NAME = "roo-code-cookie-consent"

/**
 * Possible values for the consent cookie
 */
export type ConsentCookieValue = "true" | "false"

/**
 * Cookie consent event names for communication between components
 */
export const COOKIE_CONSENT_EVENTS = {
	CHANGED: "cookieConsentChanged",
} as const
