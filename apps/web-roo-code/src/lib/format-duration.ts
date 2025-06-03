export const formatDuration = (durationMs: number) => {
	const seconds = Math.floor(durationMs / 1000)
	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const remainingSeconds = seconds % 60

	const parts = []

	if (hours > 0) {
		parts.push(`${hours}h`)
	}

	if (minutes > 0) {
		parts.push(`${minutes}m`)
	}

	if (remainingSeconds > 0 || parts.length === 0) {
		parts.push(`${remainingSeconds}s`)
	}

	return parts.join(" ")
}
