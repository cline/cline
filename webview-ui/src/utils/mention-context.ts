/*
Mention regex
- File and folder paths (starting with '/')
- URLs (containing '://')
- The 'problems' keyword
- Word boundary after 'problems' to avoid partial matches
*/
export const mentionRegex = /@((?:\/|\w+:\/\/)[^\s]+|problems\b)/
export const mentionRegexGlobal = new RegExp(mentionRegex.source, "g")

export function insertMention(text: string, position: number, value: string): string {
	const beforeCursor = text.slice(0, position)
	const afterCursor = text.slice(position)

	// Find the position of the last '@' symbol before the cursor
	const lastAtIndex = beforeCursor.lastIndexOf("@")

	if (lastAtIndex !== -1) {
		// If there's an '@' symbol, replace everything after it with the new mention
		const beforeMention = text.slice(0, lastAtIndex)
		return beforeMention + "@" + value + " " + afterCursor.replace(/^[^\s]*/, "")
	} else {
		// If there's no '@' symbol, insert the mention at the cursor position
		return beforeCursor + "@" + value + " " + afterCursor
	}
}

export function removeMention(text: string, position: number): { newText: string; newPosition: number } {
	const beforeCursor = text.slice(0, position)
	const afterCursor = text.slice(position)

	// Check if we're at the end of a mention
	const matchEnd = beforeCursor.match(new RegExp(mentionRegex.source + "$"))

	if (matchEnd) {
		// If we're at the end of a mention, remove it
		const newText = text.slice(0, position - matchEnd[0].length) + afterCursor.replace(" ", "") // removes the first space after the mention
		const newPosition = position - matchEnd[0].length
		return { newText, newPosition }
	}

	// If we're not at the end of a mention, just return the original text and position
	return { newText: text, newPosition: position }
}

// export function queryPaths(
// 	query: string,
// 	searchPaths: { type: string; path: string }[]
// ): { type: string; path: string }[] {
// 	const lowerQuery = query.toLowerCase()
// 	return searchPaths.filter(
// 		(item) => item.path.toLowerCase().includes(lowerQuery) || item.type.toLowerCase().includes(lowerQuery)
// 	)
// }

export function getContextMenuOptions(
	query: string,
	selectedType: string | null = null,
	searchPaths: { type: string; path: string }[]
): { type: string; value: string; icon: string }[] {
	if (query === "") {
		if (selectedType === "file") {
			return searchPaths
				.filter((item) => item.type === "file")
				.map((item) => ({ type: "file", value: item.path, icon: "file" }))
		}

		if (selectedType === "folder") {
			return searchPaths
				.filter((item) => item.type === "folder")
				.map((item) => ({ type: "folder", value: item.path, icon: "folder" }))
		}
		return [
			{ type: "url", value: "url", icon: "link" },
			{
				type: "problems",
				value: "problems",
				icon: "warning",
			},
			{ type: "folder", value: "folder", icon: "folder" },
			{ type: "file", value: "file", icon: "file" },
		]
	}

	const lowerQuery = query.toLowerCase()

	if (query.startsWith("http")) {
		// URLs
		return [{ type: "url", value: query, icon: "link" }]
	} else {
		// Search for files and folders
		const matchingPaths = searchPaths.filter((item) => item.path.toLowerCase().includes(lowerQuery))

		if (matchingPaths.length > 0) {
			return matchingPaths.map((item) => ({
				type: item.type,
				value: item.path,
				icon: item.type === "file" ? "file" : item.type === "problems" ? "warning" : "folder",
			}))
		} else {
			// If no matches, show all options
			return [
				{ type: "url", value: "url", icon: "link" },
				{
					type: "problems",
					value: "problems",
					icon: "warning",
				},
				{ type: "folder", value: "folder", icon: "folder" },
				{ type: "file", value: "file", icon: "file" },
			]
		}
	}
}

export function shouldShowContextMenu(text: string, position: number): boolean {
	const beforeCursor = text.slice(0, position)
	const atIndex = beforeCursor.lastIndexOf("@")

	if (atIndex === -1) return false

	const textAfterAt = beforeCursor.slice(atIndex + 1)

	// Check if there's any whitespace after the '@'
	if (/\s/.test(textAfterAt)) return false

	// Don't show the menu if it's a URL
	if (textAfterAt.toLowerCase().startsWith("http")) return false

	// Don't show the menu if it's a problems
	if (textAfterAt.toLowerCase().startsWith("problems")) return false

	// Show the menu if there's just '@' or '@' followed by some text (but not a URL)
	return true
}
