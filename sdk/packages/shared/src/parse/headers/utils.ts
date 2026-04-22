export function parseKeyPairsIntoRecord(
	value?: string,
): Record<string, string> {
	const result: Record<string, string> = {};

	if (!value) {
		return result;
	}

	try {
		value.split(",").forEach((entry) => {
			const separatorIndex = entry.indexOf("=");
			if (separatorIndex <= 0) return;

		    // From the beginning to the equal sign is the key, from the equal sign to the end is the value
			const key = decodeURIComponent(entry.substring(0, separatorIndex).trim());
			const value = decodeURIComponent(
				entry.substring(separatorIndex + 1).trim(),
			);

			if (!key || !value) return;

			result[key] = value;
		});
	} catch {}

	return result;
}
