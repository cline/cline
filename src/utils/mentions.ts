export const EXT_PREFIX = "@extension:"

export async function resolveExtensionQueries(
	textToBeResolved: string,
	resolve: (toBeResolved: string) => Thenable<string>,
): Promise<string> {
	const regex = /@extension:[\w.-]+/g
	const placeholders = [...new Set(textToBeResolved.match(regex) || [])] // Get unique placeholders

	if (placeholders.length === 0) return textToBeResolved

	const entries = await Promise.all(
		placeholders.map(
			async (placeholder): Promise<[string, string]> => [placeholder, await resolve(placeholder.slice(EXT_PREFIX.length))],
		),
	)

	const replacements = new Map(entries)
	return textToBeResolved.replace(regex, (match) => replacements.get(match) ?? match)
}
