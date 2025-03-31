import { findUriInDirs } from "../../utils/uri"
import { getClipboardContent, getDiff, getWorkspaceDirs } from "../../utils/vscode"
import { ContextRetrievalService } from "../context/ContextRetrievalService"
import { GetLspDefinitionsFunction } from "../types"
import { HelperVars } from "../util/HelperVars"
import * as vscode from "vscode"

import { AutocompleteClipboardSnippet, AutocompleteCodeSnippet, AutocompleteDiffSnippet, AutocompleteSnippetType } from "./types"

export interface SnippetPayload {
	rootPathSnippets: AutocompleteCodeSnippet[]
	importDefinitionSnippets: AutocompleteCodeSnippet[]
	recentlyEditedRangeSnippets: AutocompleteCodeSnippet[]
	recentlyVisitedRangesSnippets: AutocompleteCodeSnippet[]
	diffSnippets: AutocompleteDiffSnippet[]
	clipboardSnippets: AutocompleteClipboardSnippet[]
}

function racePromise<T>(promise: Promise<T[]>): Promise<T[]> {
	const timeoutPromise = new Promise<T[]>((resolve) => {
		setTimeout(() => resolve([]), 10_000)
	})

	return Promise.race([promise, timeoutPromise])
}

class DiffSnippetsCache {
	private cache: Map<number, any> = new Map()
	private lastTimestamp: number = 0

	public set<T>(timestamp: number, value: T): T {
		// Clear old cache entry if exists
		if (this.lastTimestamp !== timestamp) {
			this.cache.clear()
		}
		this.lastTimestamp = timestamp
		this.cache.set(timestamp, value)
		return value
	}

	public get(timestamp: number): any | undefined {
		return this.cache.get(timestamp)
	}
}

const diffSnippetsCache = new DiffSnippetsCache()

function getSnippetsFromRecentlyEditedRanges(helper: HelperVars): AutocompleteCodeSnippet[] {
	if (helper.options.useRecentlyEdited === false) {
		return []
	}

	return helper.input.recentlyEditedRanges.map((range) => {
		return {
			filepath: range.filepath,
			content: range.lines.join("\n"),
			type: AutocompleteSnippetType.Code,
		}
	})
}

const getClipboardSnippets = async (context: vscode.ExtensionContext): Promise<AutocompleteClipboardSnippet[]> => {
	const content = await getClipboardContent(context)

	return [content].map((item) => {
		return {
			content: item.text,
			copiedAt: item.copiedAt,
			type: AutocompleteSnippetType.Clipboard,
		}
	})
}

const getDiffSnippets = async (): Promise<AutocompleteDiffSnippet[]> => {
	const currentTimestamp = Math.floor(Date.now() / 10000) * 10000 // Defaults to update once in every 10 seconds

	// Check cache first
	const cached = diffSnippetsCache.get(currentTimestamp) as AutocompleteDiffSnippet[]

	if (cached) {
		return cached
	}

	let diff: string[] = []
	try {
		diff = await getDiff(true)
	} catch (e) {
		console.error("Error getting diff for autocomplete", e)
	}

	return diffSnippetsCache.set(
		currentTimestamp,
		diff.map((item) => {
			return {
				content: item,
				type: AutocompleteSnippetType.Diff,
			}
		}),
	)
}

export const getAllSnippets = async (
	context: vscode.ExtensionContext,
	{
		helper,
		contextRetrievalService,
	}: {
		helper: HelperVars
		contextRetrievalService: ContextRetrievalService
	},
): Promise<SnippetPayload> => {
	const recentlyEditedRangeSnippets = getSnippetsFromRecentlyEditedRanges(helper)

	const [rootPathSnippets, importDefinitionSnippets, diffSnippets, clipboardSnippets] = await Promise.all([
		racePromise(contextRetrievalService.getRootPathSnippets(helper)),
		racePromise(contextRetrievalService.getSnippetsFromImportDefinitions(helper)),
		racePromise(getDiffSnippets()),
		racePromise(getClipboardSnippets(context)),
	])

	return {
		rootPathSnippets,
		importDefinitionSnippets,
		recentlyEditedRangeSnippets,
		diffSnippets,
		clipboardSnippets,
		recentlyVisitedRangesSnippets: helper.input.recentlyVisitedRanges,
	}
}
