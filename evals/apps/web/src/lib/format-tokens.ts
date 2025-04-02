export const formatTokens = (tokens: number) => {
	if (tokens < 1000) {
		return tokens.toString()
	}

	return `${(tokens / 1000).toFixed(1)}k`
}
