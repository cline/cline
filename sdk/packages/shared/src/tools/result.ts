/** Text-only representation for summaries and character budgets; binary images
 * retain their separate native media budget instead of becoming base64 prose. */
export function stringifyToolResultData(value: unknown): string {
	return (
		JSON.stringify(value, (_key, entry: unknown) => {
			if (
				entry &&
				typeof entry === "object" &&
				"type" in entry &&
				entry.type === "image"
			) {
				return `[image:${"mediaType" in entry ? entry.mediaType : "unknown"}]`;
			}
			return entry;
		}) ?? ""
	);
}
