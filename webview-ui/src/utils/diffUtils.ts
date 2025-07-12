import * as diff from "diff"

export function parseSearchReplace(searchText: string): Array<{ search: string; replace: string }> {
	console.log("Parsing search/replace text:", searchText)
	const blocks = searchText.split("------- SEARCH").filter(Boolean)
	console.log("Split into blocks:", blocks)
	const result = blocks.map((block) => {
		const [search, ...replaceParts] = block.split("=======")
		const replace = replaceParts.join("=======").split("+++++++ REPLACE")[0]
		const parsed = {
			search: search.trim(),
			replace: replace.trim(),
		}
		console.log("Parsed block:", parsed)
		return parsed
	})
	console.log("All parsed blocks:", result)
	return result
}

export function createUnifiedDiff(original: string, modified: string): string {
	console.log("Creating unified diff for:", { original, modified })
	const patch = diff.createPatch("file", original, modified)
	console.log("Raw patch:", patch)
	const lines = patch.split("\n")

	// Find the first @@ line (hunk header) and start from there
	const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@"))
	if (firstHunkIndex === -1) {
		// No hunks found, return empty
		console.log("No hunks found in patch")
		return ""
	}

	// Filter out the distracting "No newline at end of file" message
	const diffLines = lines.slice(firstHunkIndex).filter((line) => !line.startsWith("\\ No newline at end of file"))

	const result = diffLines.join("\n")
	console.log("Processed unified diff result:", result)
	return result
}
