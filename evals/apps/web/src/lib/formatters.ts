const formatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
})

export const formatCurrency = (amount: number) => formatter.format(amount)

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

export const formatTokens = (tokens: number) => {
	if (tokens < 1000) {
		return tokens.toString()
	}

	if (tokens < 1000000) {
		return `${(tokens / 1000).toFixed(1)}k`
	}

	if (tokens < 1000000000) {
		return `${(tokens / 1000000).toFixed(1)}M`
	}

	return `${(tokens / 1000000000).toFixed(1)}B`
}

export const formatToolUsageSuccessRate = (usage: { attempts: number; failures: number }) =>
	usage.attempts === 0 ? "0%" : `${(((usage.attempts - usage.failures) / usage.attempts) * 100).toFixed(1)}%`
