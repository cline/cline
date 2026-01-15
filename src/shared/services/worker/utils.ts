export function getUtcTimestamp(): string {
	const now = new Date()
	return now.toISOString().replaceAll(":", "-").replaceAll("-", "").split(".")[0]
}
