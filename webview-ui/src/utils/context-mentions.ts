import { mentionRegex } from "@roo/shared/context-mentions"
import { Fzf } from "fzf"
import { ModeConfig } from "@roo/shared/modes"

import { escapeSpaces } from "./path-mentions"

export interface SearchResult {
	path: string
	type: "file" | "folder"
	label?: string
}

function getBasename(filepath: string): string {
	return filepath.split("/").pop() || filepath
}

export function insertMention(
	text: string,
	position: number,
	value: string,
): { newValue: string; mentionIndex: number } {
	// Handle slash command
	if (text.startsWith("/")) {
		return {
			newValue: value,
			mentionIndex: 0,
		}
	}

	const beforeCursor = text.slice(0, position)
	const afterCursor = text.slice(position)

	// Find the position of the last '@' symbol before the cursor
	const lastAtIndex = beforeCursor.lastIndexOf("@")

	// Process the value - escape spaces if it's a file path
	let processedValue = value
	if (value && value.startsWith("/")) {
		// Only escape if the path contains spaces that aren't already escaped
		if (value.includes(" ") && !value.includes("\\ ")) {
			processedValue = escapeSpaces(value)
		}
	}

	let newValue: string
	let mentionIndex: number

	if (lastAtIndex !== -1) {
		// If there's an '@' symbol, replace everything after it with the new mention
		const beforeMention = text.slice(0, lastAtIndex)
		// Only replace if afterCursor is all alphanumerical
		// This is required to handle languages that don't use space as a word separator (chinese, japanese, korean, etc)
		const afterCursorContent = /^[a-zA-Z0-9\s]*$/.test(afterCursor)
			? afterCursor.replace(/^[^\s]*/, "")
			: afterCursor
		newValue = beforeMention + "@" + processedValue + " " + afterCursorContent
		mentionIndex = lastAtIndex
	} else {
		// If there's no '@' symbol, insert the mention at the cursor position
		newValue = beforeCursor + "@" + processedValue + " " + afterCursor
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
		// Remove the mention and the first space that follows it
		const mentionLength = matchEnd[0].length
		// Remove the mention and one space after it if it exists
		const newText = text.slice(0, position - mentionLength) + afterCursor.replace(/^\s/, "")
		const newPosition = position - mentionLength
		return { newText, newPosition }
	}

	// If we're not at the end of a mention, just return the original text and position
	return { newText: text, newPosition: position }
}

export enum ContextMenuOptionType {
	OpenedFile = "openedFile",
	File = "file",
	Folder = "folder",
	Problems = "problems",
	Terminal = "terminal",
	URL = "url",
	Git = "git",
	NoResults = "noResults",
	Mode = "mode", // Add mode type
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
	inputValue: string,
	selectedType: ContextMenuOptionType | null = null,
	queryItems: ContextMenuQueryItem[],
	dynamicSearchResults: SearchResult[] = [],
	modes?: ModeConfig[],
): ContextMenuQueryItem[] {
	// Handle slash commands for modes
	if (query.startsWith("/") && inputValue.startsWith("/")) {
		const modeQuery = query.slice(1)
		if (!modes?.length) return [{ type: ContextMenuOptionType.NoResults }]

		// Create searchable strings array for fzf
		const searchableItems = modes.map((mode) => ({
			original: mode,
			searchStr: mode.name,
		}))

		// Initialize fzf instance for fuzzy search
		const fzf = new Fzf(searchableItems, {
			selector: (item) => item.searchStr,
		})

		// Get fuzzy matching items
		const matchingModes = modeQuery
			? fzf.find(modeQuery).map((result) => ({
					type: ContextMenuOptionType.Mode,
					value: result.item.original.slug,
					label: result.item.original.name,
					description: (result.item.original.whenToUse || result.item.original.roleDefinition).split("\n")[0],
				}))
			: modes.map((mode) => ({
					type: ContextMenuOptionType.Mode,
					value: mode.slug,
					label: mode.name,
					description: (mode.whenToUse || mode.roleDefinition).split("\n")[0],
				}))

		return matchingModes.length > 0 ? matchingModes : [{ type: ContextMenuOptionType.NoResults }]
	}

	const workingChanges: ContextMenuQueryItem = {
		type: ContextMenuOptionType.Git,
		value: "git-changes",
		label: "Working changes",
		description: "Current uncommitted changes",
		icon: "$(git-commit)",
	}

	if (query === "") {
		if (selectedType === ContextMenuOptionType.File) {
			const files = queryItems
				.filter(
					(item) =>
						item.type === ContextMenuOptionType.File || item.type === ContextMenuOptionType.OpenedFile,
				)
				.map((item) => ({
					type: item.type,
					value: item.value,
				}))
			return files.length > 0 ? files : [{ type: ContextMenuOptionType.NoResults }]
		}

		if (selectedType === ContextMenuOptionType.Folder) {
			const folders = queryItems
				.filter((item) => item.type === ContextMenuOptionType.Folder)
				.map((item) => ({ type: ContextMenuOptionType.Folder, value: item.value }))
			return folders.length > 0 ? folders : [{ type: ContextMenuOptionType.NoResults }]
		}

		if (selectedType === ContextMenuOptionType.Git) {
			const commits = queryItems.filter((item) => item.type === ContextMenuOptionType.Git)
			return commits.length > 0 ? [workingChanges, ...commits] : [workingChanges]
		}

		return [
			{ type: ContextMenuOptionType.Problems },
			{ type: ContextMenuOptionType.Terminal },
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
			icon: "$(git-commit)",
		})
	} else if ("git-changes".startsWith(lowerQuery)) {
		suggestions.push(workingChanges)
	}
	if ("problems".startsWith(lowerQuery)) {
		suggestions.push({ type: ContextMenuOptionType.Problems })
	}
	if ("terminal".startsWith(lowerQuery)) {
		suggestions.push({ type: ContextMenuOptionType.Terminal })
	}
	if (query.startsWith("http")) {
		suggestions.push({ type: ContextMenuOptionType.URL, value: query })
	}

	// Add exact SHA matches to suggestions
	if (/^[a-f0-9]{7,40}$/i.test(lowerQuery)) {
		const exactMatches = queryItems.filter(
			(item) => item.type === ContextMenuOptionType.Git && item.value?.toLowerCase() === lowerQuery,
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
				icon: "$(git-commit)",
			})
		}
	}

	const searchableItems = queryItems.map((item) => ({
		original: item,
		searchStr: [item.value, item.label, item.description].filter(Boolean).join(" "),
	}))

	// Initialize fzf instance for fuzzy search
	const fzf = new Fzf(searchableItems, {
		selector: (item) => item.searchStr,
	})

	// Get fuzzy matching items
	const matchingItems = query ? fzf.find(query).map((result) => result.item.original) : []

	// Separate matches by type
	const openedFileMatches = matchingItems.filter((item) => item.type === ContextMenuOptionType.OpenedFile)

	const gitMatches = matchingItems.filter((item) => item.type === ContextMenuOptionType.Git)

	// Convert search results to queryItems format
	const searchResultItems = dynamicSearchResults.map((result) => {
		// Ensure paths start with / for consistency
		const formattedPath = result.path.startsWith("/") ? result.path : `/${result.path}`

		// For display purposes, we don't escape spaces in the label or description
		const displayPath = formattedPath
		const displayName = result.label || getBasename(result.path)

		// We don't need to escape spaces here because the insertMention function
		// will handle that when the user selects a suggestion

		return {
			type: result.type === "folder" ? ContextMenuOptionType.Folder : ContextMenuOptionType.File,
			value: formattedPath,
			label: displayName,
			description: displayPath,
		}
	})

	const allItems = [...suggestions, ...openedFileMatches, ...searchResultItems, ...gitMatches]

	// Remove duplicates - normalize paths by ensuring all have leading slashes
	const seen = new Set()
	const deduped = allItems.filter((item) => {
		// Normalize paths for deduplication by ensuring leading slashes
		const normalizedValue = item.value
		let key = ""
		if (
			item.type === ContextMenuOptionType.File ||
			item.type === ContextMenuOptionType.Folder ||
			item.type === ContextMenuOptionType.OpenedFile
		) {
			key = normalizedValue!
		} else {
			key = `${item.type}-${normalizedValue}`
		}
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})

	return deduped.length > 0 ? deduped : [{ type: ContextMenuOptionType.NoResults }]
}

export function shouldShowContextMenu(text: string, position: number): boolean {
	// Handle slash command
	if (text.startsWith("/")) {
		return position <= text.length && !text.includes(" ")
	}
	const beforeCursor = text.slice(0, position)
	const atIndex = beforeCursor.lastIndexOf("@")

	if (atIndex === -1) {
		return false
	}

	const textAfterAt = beforeCursor.slice(atIndex + 1)

	// Check if there's any unescaped whitespace after the '@'
	// We need to check for whitespace that isn't preceded by a backslash
	// Using a negative lookbehind to ensure the space isn't escaped
	const hasUnescapedSpace = /(?<!\\)\s/.test(textAfterAt)
	if (hasUnescapedSpace) return false

	// Don't show the menu if it's clearly a URL
	if (textAfterAt.toLowerCase().startsWith("http")) {
		return false
	}

	// Show menu in all other cases
	return true
}
