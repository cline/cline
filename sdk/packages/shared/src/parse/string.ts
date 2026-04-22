export function sanitizeFileName(value: string): string {
	return value.toLowerCase().replace(/[^\w.-]+/g, "_");
}

export function truncateStr(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return `${str.slice(0, maxLen - 1)}…`;
}

export function truncateSplit(
	str?: string,
	splitBy = "/",
	maxLen = 100,
): string {
	if (!str || str.length <= maxLen) return str || "";
	const prefix = str
		.split(splitBy)
		?.shift()
		?.trim()
		?.slice(0, maxLen - 1);
	return prefix ? `${prefix}…` : truncateStr(str, maxLen);
}

export function maskSecret(value: string): string {
	if (value.length <= 8) {
		return "****";
	}
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
