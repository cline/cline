/** Narrow message matching also handles errors serialized by the sidecar. */
export function isTranscriptionNetworkError(error: unknown): boolean {
	const seen = new Set<unknown>();
	while (error && !seen.has(error)) {
		seen.add(error);
		const record =
			typeof error === "object"
				? (error as {
						message?: unknown;
						name?: unknown;
						statusCode?: unknown;
						cause?: unknown;
					})
				: undefined;
		// An HTTP response is a provider failure, not loss of connectivity.
		if (typeof record?.statusCode === "number") return false;
		if (record?.name === "AbortError") return false;
		const message = typeof error === "string" ? error : record?.message;
		if (
			typeof message === "string" &&
			/(failed to fetch|fetch failed|networkerror|network request failed|load failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|unable to connect|connection (?:timed out|was lost)|network connection was lost|network is too slow)/i.test(
				message,
			)
		)
			return true;
		error = record?.cause;
	}
	return false;
}
