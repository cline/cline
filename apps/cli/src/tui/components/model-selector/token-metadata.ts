export function hasDisplayableTokenCount(
	tokens: number | undefined,
): tokens is number {
	return typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0;
}
