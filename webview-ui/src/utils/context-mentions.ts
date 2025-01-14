import { mentionRegex } from "../../../src/shared/context-mentions"
import Fuse from "fuse.js"

export function insertMention(
	text: string,
	position: number,
	value: string,
): { newValue: string; mentionIndex: number } {
	const beforeCursor = text.slice(0, position)
	const afterCursor = text.slice(position)

	// Find the position of the last '@' symbol before the cursor
	const lastAtIndex = beforeCursor.lastIndexOf("@")

	let newValue: string
	let mentionIndex: number

	if (lastAtIndex !== -1) {
		// If there's an '@' symbol, replace everything after it with the new mention
		const beforeMention = text.slice(0, lastAtIndex)
		newValue = beforeMention + "@" + value + " " + afterCursor.replace(/^[^\s]*/, "")
		mentionIndex = lastAtIndex
	} else {
		// If there's no '@' symbol, insert the mention at the cursor position
		newValue = beforeCursor + "@" + value + " " + afterCursor
		mentionIndex = position
	}

	return { newValue, mentionIndex }
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

export enum ContextMenuOptionType {
	File = "file",
	Folder = "folder",
	Problems = "problems",
	URL = "url",
	Git = "git",
	NoResults = "noResults",
}

export interface ContextMenuQueryItem {
	type: ContextMenuOptionType
	value?: string
	label?: string
	description?: string
	icon?: string
}

export function getContextMenuOptions(
	query: string,
	selectedType: ContextMenuOptionType | null = null,
	queryItems: ContextMenuQueryItem[],
): ContextMenuQueryItem[] {
	const workingChanges: ContextMenuQueryItem = {
		type: ContextMenuOptionType.Git,
		value: "git-changes",
		label: "Working changes",
		description: "Current uncommitted changes",
		icon: "$(git-commit)"
	}

	if (query === "") {
		if (selectedType === ContextMenuOptionType.File) {
			const files = queryItems
				.filter((item) => item.type === ContextMenuOptionType.File)
				.map((item) => ({ type: ContextMenuOptionType.File, value: item.value }))
			return files.length > 0 ? files : [{ type: ContextMenuOptionType.NoResults }]
		}

		if (selectedType === ContextMenuOptionType.Folder) {
			const folders = queryItems
				.filter((item) => item.type === ContextMenuOptionType.Folder)
				.map((item) => ({ type: ContextMenuOptionType.Folder, value: item.value }))
			return folders.length > 0 ? folders : [{ type: ContextMenuOptionType.NoResults }]
		}

		if (selectedType === ContextMenuOptionType.Git) {
			const commits = queryItems
				.filter((item) => item.type === ContextMenuOptionType.Git)
			return commits.length > 0 ? [workingChanges, ...commits] : [workingChanges]
		}

		return [
			{ type: ContextMenuOptionType.Problems },
			{ type: ContextMenuOptionType.URL },
			{ type: ContextMenuOptionType.Folder },
			{ type: ContextMenuOptionType.File },
			{ type: ContextMenuOptionType.Git },
		]
	}

	const lowerQuery = query.toLowerCase()
	const suggestions: ContextMenuQueryItem[] = []

	// Check for top-level option matches
	if ("git".startsWith(lowerQuery)) {
		suggestions.push({ 
			type: ContextMenuOptionType.Git,
			label: "Git Commits",
			description: "Search repository history",
			icon: "$(git-commit)"
		})
	} else if ("git-changes".startsWith(lowerQuery)) {
		suggestions.push(workingChanges)
	}
	if ("problems".startsWith(lowerQuery)) {
		suggestions.push({ type: ContextMenuOptionType.Problems })
	}
	if (query.startsWith("http")) {
		suggestions.push({ type: ContextMenuOptionType.URL, value: query })
	}

	// Add exact SHA matches to suggestions
	if (/^[a-f0-9]{7,40}$/i.test(lowerQuery)) {
		const exactMatches = queryItems.filter((item) =>
			item.type === ContextMenuOptionType.Git &&
			item.value?.toLowerCase() === lowerQuery
		)
		if (exactMatches.length > 0) {
			suggestions.push(...exactMatches)
		} else {
			// If no exact match but valid SHA format, add as option
			suggestions.push({
				type: ContextMenuOptionType.Git,
				value: lowerQuery,
				label: `Commit ${lowerQuery}`,
				description: "Git commit hash",
				icon: "$(git-commit)"
			})
		}
	}

	// Initialize Fuse instance for fuzzy search
	const fuse = new Fuse(queryItems, {
		keys: ["value", "label", "description"],
		threshold: 0.6,
		shouldSort: true,
		isCaseSensitive: false,
		ignoreLocation: false,
		minMatchCharLength: 1,
	})

	// Get fuzzy matching items
	const fuseResults = query ? fuse.search(query) : []
	const matchingItems = fuseResults.map(result => result.item)

	// Separate matches by type
	const fileMatches = matchingItems.filter(item =>
		item.type === ContextMenuOptionType.File ||
		item.type === ContextMenuOptionType.Folder
	)
	const gitMatches = matchingItems.filter(item =>
		item.type === ContextMenuOptionType.Git
	)
	const otherMatches = matchingItems.filter(item =>
		item.type !== ContextMenuOptionType.File &&
		item.type !== ContextMenuOptionType.Folder &&
		item.type !== ContextMenuOptionType.Git
	)

	// Combine suggestions with matching items in the desired order
	if (suggestions.length > 0 || matchingItems.length > 0) {
		return [...suggestions, ...fileMatches, ...gitMatches, ...otherMatches]
	}

	return [{ type: ContextMenuOptionType.NoResults }]
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

	// NOTE: it's okay that menu shows when there's trailing punctuation since user could be inputting a path with marks

	// Show the menu if there's just '@' or '@' followed by some text (but not a URL)
	return true
}
