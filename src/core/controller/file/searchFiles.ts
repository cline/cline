import { Controller } from "../index"
import { StreamingResponseHandler } from "../grpc-handler"
import { FileStreamingMethodHandler } from "./index"
import { regexSearchFiles } from "@services/ripgrep"
import * as path from "path"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import { cwd } from "@core/task"

/**
 * Parse the formatted search results string into structured data
 */
interface FileMatch {
	path: string
	type: string
	matches: Array<{
		lineNumber: number
		lineContent: string
		contextBefore: string
		contextAfter: string
	}>
}

function parseSearchResults(resultsText: string): FileMatch[] {
	const fileMatches: FileMatch[] = []

	// Split by double newlines to get file sections
	const fileSections = resultsText.split("\n\n")

	for (const section of fileSections) {
		// Skip the summary line
		if (section.startsWith("Found ") || section.startsWith("Showing first ")) {
			continue
		}

		const lines = section.split("\n")
		if (lines.length < 2) continue

		const filePath = lines[0]
		if (!filePath) continue

		const fileMatch: FileMatch = {
			path: filePath,
			type: "file",
			matches: [],
		}

		let currentMatch: {
			lineNumber: number
			lineContent: string
			contextBefore: string[]
			contextAfter: string[]
		} | null = null

		let contextLines: string[] = []

		// Process the content lines (skip the first line which is the file path and the second which is "│----")
		for (let i = 2; i < lines.length; i++) {
			const line = lines[i]

			// Skip separator lines
			if (line === "│----") {
				if (currentMatch) {
					fileMatch.matches.push({
						lineNumber: currentMatch.lineNumber,
						lineContent: currentMatch.lineContent,
						contextBefore: currentMatch.contextBefore.join("\n"),
						contextAfter: currentMatch.contextAfter.join("\n"),
					})
					currentMatch = null
				}
				contextLines = []
				continue
			}

			// Process content line (remove the leading "│")
			const content = line.substring(1)

			// For simplicity, we'll just collect all lines and assume the match is in the middle
			contextLines.push(content)

			// If we have 3 lines, create a match (1 line before, match, 1 line after)
			if (contextLines.length === 3 && !currentMatch) {
				currentMatch = {
					lineNumber: i - 2, // Approximate line number
					lineContent: contextLines[1],
					contextBefore: [contextLines[0]],
					contextAfter: [contextLines[2]],
				}
				contextLines = []
			}
		}

		// Add the last match if there is one
		if (currentMatch) {
			fileMatch.matches.push({
				lineNumber: currentMatch.lineNumber,
				lineContent: currentMatch.lineContent,
				contextBefore: currentMatch.contextBefore.join("\n"),
				contextAfter: currentMatch.contextAfter.join("\n"),
			})
		}

		if (fileMatch.matches.length > 0) {
			fileMatches.push(fileMatch)
		}
	}

	return fileMatches
}

/**
 * Implementation of the searchFiles streaming method
 *
 * This method searches for files matching a pattern and streams the results back
 * to the client as they are found.
 */
export const searchFiles: FileStreamingMethodHandler = async (
	controller: Controller,
	message: any,
	responseStream: StreamingResponseHandler,
) => {
	const { path: searchPath, pattern, regex, recursive } = message

	// Validate inputs
	if (!searchPath) {
		throw new Error("Path is required for searchFiles")
	}

	if (!regex) {
		throw new Error("Regex is required for searchFiles")
	}

	// Create a ClineIgnoreController to respect .clineignore rules
	const ignoreController = new ClineIgnoreController(cwd)
	await ignoreController.initialize()

	try {
		// Resolve the absolute path
		const absolutePath = path.resolve(cwd, searchPath)

		// Set up sequence number for ordering responses
		let sequenceNumber = 0

		// Since regexSearchFiles doesn't support streaming directly,
		// we'll simulate streaming by sending results in batches

		// First, send an initial response to indicate the search has started
		await responseStream(
			{
				results: [],
				isComplete: false,
			},
			false, // Not the last message
			sequenceNumber++,
		)

		// Perform the search
		const resultsText = await regexSearchFiles(cwd, absolutePath, regex, pattern || undefined, ignoreController)

		// Parse the results
		const fileMatches = parseSearchResults(resultsText)

		// If we have a lot of results, split them into batches to simulate streaming
		const BATCH_SIZE = 5
		for (let i = 0; i < fileMatches.length; i += BATCH_SIZE) {
			const batch = fileMatches.slice(i, i + BATCH_SIZE)
			const isLastBatch = i + BATCH_SIZE >= fileMatches.length

			await responseStream(
				{
					results: batch,
					isComplete: isLastBatch,
				},
				isLastBatch, // Is this the last message?
				sequenceNumber++,
			)

			// Add a small delay to simulate streaming
			if (!isLastBatch) {
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
		}

		// If no results were found, send a completion message
		if (fileMatches.length === 0) {
			await responseStream(
				{
					results: [],
					isComplete: true,
				},
				true, // This is the last message
				sequenceNumber,
			)
		}
	} finally {
		// Clean up resources
		ignoreController.dispose()
	}
}
