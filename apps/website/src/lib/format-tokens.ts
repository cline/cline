export const formatTokens = (tokens: number, decimals = 0) => {
	if (tokens < 1000) {
		return tokens.toString()
	}

	if (tokens < 1000000) {
		return `${(tokens / 1000).toFixed(decimals)}K`
	}

	if (tokens < 1000000000) {
		return `${(tokens / 1000000).toFixed(decimals)}M`
	}

	return `${(tokens / 1000000000).toFixed(decimals)}B`
}
