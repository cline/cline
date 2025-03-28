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

export function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp)

	const dateFormatter = new Intl.DateTimeFormat("en-US", {
		month: "2-digit",
		day: "2-digit",
		year: "2-digit",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	})

	return dateFormatter.format(date)
}

/**
 * Format a timestamp as a relative time string (e.g., "5 minutes ago")
 * This is a simple implementation to replace date-fns formatDistanceToNow
 * @param timestamp The timestamp to format (milliseconds since epoch)
 * @returns A string representing the relative time
 */
export function formatDistanceToNow(timestamp: number): string {
	const now = Date.now()
	const diff = now - timestamp

	// Convert to seconds
	const seconds = Math.floor(diff / 1000)

	if (seconds < 60) {
		return seconds === 1 ? "1 second" : `${seconds} seconds`
	}

	// Convert to minutes
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) {
		return minutes === 1 ? "1 minute" : `${minutes} minutes`
	}

	// Convert to hours
	const hours = Math.floor(minutes / 60)
	if (hours < 24) {
		return hours === 1 ? "1 hour" : `${hours} hours`
	}

	// Convert to days
	const days = Math.floor(hours / 24)
	if (days < 30) {
		return days === 1 ? "1 day" : `${days} days`
	}

	// Convert to months
	const months = Math.floor(days / 30)
	if (months < 12) {
		return months === 1 ? "1 month" : `${months} months`
	}

	// Convert to years
	const years = Math.floor(months / 12)
	return years === 1 ? "1 year" : `${years} years`
}
