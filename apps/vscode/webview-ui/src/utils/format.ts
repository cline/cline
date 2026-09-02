import prettyBytes from "pretty-bytes"
import { i18n } from "../i18n"

/** BCP-47 tag of the active UI locale, for Intl-based formatting. */
export function uiLocale(): string {
	return i18n.language || "en"
}

export function formatLargeNumber(num: number): string {
	if (num >= 1e9) {
		return (num / 1e9).toFixed(1) + "b"
	}
	if (num >= 1e6) {
		return (num / 1e6).toFixed(1) + "m"
	}
	if (num >= 1e3) {
		return (num / 1e3).toFixed(1) + "k"
	}
	return num.toString()
}

// Helper to format cents as dollars with 2 decimal places
export function formatDollars(cents?: number): string {
	if (cents === undefined) {
		return ""
	}

	return (cents / 100).toFixed(2)
}

/**
 * Converts microcredits to credits for display purposes.
 *
 * The backend stores credit balances in microcredits (1 credit = 10,000 microcredits)
 * to avoid floating point precision issues when performing calculations.
 * This function converts the microcredits back to the user-facing credit amount.
 *
 * @param microcredits - The balance in microcredits from the backend
 * @returns The balance in credits (typically displayed with 4 decimal places)
 *
 * @example
 * formatCreditsBalance(50000) // returns 5.0000 (credits)
 * formatCreditsBalance(12345) // returns 1.2345 (credits)
 */
export function formatCreditsBalance(microcredits: number): number {
	return microcredits / 10000
}

export function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp)

	const dateFormatter = new Intl.DateTimeFormat(uiLocale(), {
		month: "2-digit",
		day: "2-digit",
		year: "2-digit",
		hour: "numeric",
		minute: "2-digit",
	})

	return dateFormatter.format(date)
}

/** Short date for history previews, e.g. "Sep 2". */
export function formatHistoryDate(timestamp: number): string {
	return new Date(timestamp).toLocaleString(uiLocale(), {
		month: "short",
		day: "numeric",
	})
}

/** Timestamp for history items: time-only for today, month + day + time otherwise. */
export function formatHistoryTimestamp(timestamp: number): string {
	const date = new Date(timestamp)
	const isToday = new Date().toDateString() === date.toDateString()
	const locale = uiLocale()

	const formatted = date.toLocaleString(
		locale,
		isToday ? { hour: "numeric", minute: "2-digit" } : { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" },
	)

	// Preserve the historical English rendering ("September 2, 3:45 PM" rather than "September 2 at 3:45 PM")
	return locale.startsWith("en") ? formatted.replace(", ", " ").replace(" at", ",") : formatted
}

export function formatSize(bytes?: number) {
	if (bytes === undefined) {
		return "--kb"
	}

	return prettyBytes(bytes)
}
