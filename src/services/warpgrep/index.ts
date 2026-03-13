import type { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import * as childProcess from "child_process"
import * as fs from "fs/promises"
import * as path from "path"
import * as readline from "readline"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { getBinaryLocation } from "@/utils/fs"

const WARPGREP_API_URL = "https://api.morphllm.com/v1/chat/completions"
const WARPGREP_MODEL = "morph-warp-grep-v2"
const MAX_TURNS = 4
const MAX_TOOL_CALLS_PER_TURN = 8
const MAX_GREP_LINES = 200
const MAX_READ_LINES = 800
const MAX_LIST_DIR_LINES = 200
const CONTEXT_BUDGET_CHARS = 160_000

export interface WarpGrepResult {
	success: boolean
	content: string
	turnsUsed: number
	error?: string
}

interface WarpGrepMessage {
	role: "system" | "user" | "assistant"
	content: string
}

interface ToolCall {
	functionName: string
	parameters: Record<string, string>
}

/**
 * Builds a tree-like representation of the repository structure,
 * excluding common non-essential directories.
 */
async function buildRepoStructure(cwd: string): Promise<string> {
	const ignorePatterns = new Set([
		"node_modules",
		".git",
		"__pycache__",
		"env",
		"venv",
		"dist",
		"out",
		"build",
		"target",
		".next",
		".nuxt",
		"coverage",
		".cache",
		"vendor",
		"tmp",
		"temp",
	])

	const lines: string[] = []
	const maxDepth = 4
	const maxEntries = 500

	async function walk(dir: string, prefix: string, depth: number): Promise<void> {
		if (depth > maxDepth || lines.length >= maxEntries) {
			return
		}

		let entries: string[]
		try {
			entries = await fs.readdir(dir)
		} catch {
			return
		}

		// Sort: directories first, then files
		const sorted: Array<{ name: string; isDir: boolean }> = []
		for (const name of entries) {
			if (ignorePatterns.has(name) || (name.startsWith(".") && name !== ".github")) {
				continue
			}
			try {
				const stat = await fs.stat(path.join(dir, name))
				sorted.push({ name, isDir: stat.isDirectory() })
			} catch {}
		}

		sorted.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
			return a.name.localeCompare(b.name)
		})

		for (const { name, isDir } of sorted) {
			if (lines.length >= maxEntries) break
			lines.push(`${prefix}${name}${isDir ? "/" : ""}`)
			if (isDir) {
				await walk(path.join(dir, name), `${prefix}  `, depth + 1)
			}
		}
	}

	const rootName = `${path.basename(cwd)}/`
	lines.push(rootName)
	await walk(cwd, "  ", 1)

	return lines.join("\n")
}

/**
 * Parse tool calls from the WarpGrep model response.
 */
function parseToolCalls(content: string): ToolCall[] {
	const toolCalls: ToolCall[] = []
	const regex = /<tool_call>\s*<function=(\w+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g

	for (const match of content.matchAll(regex)) {
		const functionName = match[1]
		const paramsContent = match[2]
		const parameters: Record<string, string> = {}

		const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g
		for (const paramMatch of paramsContent.matchAll(paramRegex)) {
			parameters[paramMatch[1]] = paramMatch[2].trim()
		}

		toolCalls.push({ functionName, parameters })
		if (toolCalls.length >= MAX_TOOL_CALLS_PER_TURN) break
	}

	return toolCalls
}

/**
 * Execute ripgrep with the given pattern and path.
 */
async function executeRipgrep(cwd: string, pattern: string, searchPath: string, glob?: string): Promise<string> {
	const binPath = await getBinaryLocation("rg")
	const absolutePath = path.isAbsolute(searchPath) ? searchPath : path.join(cwd, searchPath)

	const args = ["--line-number", "--no-heading", "--color", "never", "-C", "1"]
	if (glob) {
		args.push("--glob", glob)
	}
	args.push(pattern, absolutePath)

	return new Promise((resolve) => {
		const rgProcess = childProcess.spawn(binPath, args)
		const rl = readline.createInterface({
			input: rgProcess.stdout,
			crlfDelay: Number.POSITIVE_INFINITY,
		})

		const lines: string[] = []
		rl.on("line", (line) => {
			if (lines.length < MAX_GREP_LINES + 1) {
				lines.push(line)
			} else {
				rl.close()
				rgProcess.kill()
			}
		})

		rgProcess.stderr.on("data", () => {
			// Discard stderr output
		})

		rl.on("close", () => {
			if (lines.length > MAX_GREP_LINES) {
				resolve(`Error: Output exceeded ${MAX_GREP_LINES} lines. Please narrow your search.`)
			} else if (lines.length === 0) {
				resolve("No matches found.")
			} else {
				resolve(lines.join("\n"))
			}
		})

		rgProcess.on("error", () => {
			resolve(`Error: ripgrep execution failed.`)
		})
	})
}

/**
 * Read a file with optional line range, prefixed with line numbers.
 */
async function readFile(cwd: string, filePath: string, lineRange?: string): Promise<string> {
	const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)

	let content: string
	try {
		content = await fs.readFile(absolutePath, "utf-8")
	} catch {
		return `Error: Could not read file ${filePath}`
	}

	const allLines = content.split("\n")

	// Collect (lineNum, lineText) pairs from all ranges
	const selected: Array<[number, string]> = []

	if (lineRange && lineRange !== "*") {
		// Handle comma-separated ranges like "1-50,75-100"
		for (const part of lineRange.split(",")) {
			const trimmed = part.trim()
			if (!trimmed) continue
			const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/)
			if (rangeMatch) {
				const start = Math.max(1, Number.parseInt(rangeMatch[1], 10))
				const end = Math.min(allLines.length, Number.parseInt(rangeMatch[2], 10))
				for (let i = start; i <= end; i++) {
					selected.push([i, allLines[i - 1]])
				}
			} else {
				const lineNum = Number.parseInt(trimmed, 10)
				if (!Number.isNaN(lineNum) && lineNum >= 1 && lineNum <= allLines.length) {
					selected.push([lineNum, allLines[lineNum - 1]])
				}
			}
		}
	} else {
		for (let i = 0; i < allLines.length; i++) {
			selected.push([i + 1, allLines[i]])
		}
	}

	if (selected.length > MAX_READ_LINES) {
		const truncated = selected.slice(0, MAX_READ_LINES)
		return `${truncated.map(([num, line]) => `${num}|${line}`).join("\n")}\n...(truncated)`
	}

	return selected.map(([num, line]) => `${num}|${line}`).join("\n")
}

/**
 * List directory contents in a tree-like format.
 */
async function listDirectory(cwd: string, dirPath: string): Promise<string> {
	const absolutePath = path.isAbsolute(dirPath) ? dirPath : path.join(cwd, dirPath)

	let entries: string[]
	try {
		entries = await fs.readdir(absolutePath)
	} catch {
		return `Error: Could not list directory ${dirPath}`
	}

	const lines: string[] = []
	for (const entry of entries.sort()) {
		if (lines.length >= MAX_LIST_DIR_LINES) {
			return `Error: Output exceeded ${MAX_LIST_DIR_LINES} lines. Please narrow your search.`
		}
		try {
			const stat = await fs.stat(path.join(absolutePath, entry))
			lines.push(stat.isDirectory() ? `${entry}/` : entry)
		} catch {
			lines.push(entry)
		}
	}

	return lines.join("\n") || "Empty directory."
}

/**
 * Execute a single tool call and return the result.
 */
async function executeToolCall(cwd: string, toolCall: ToolCall): Promise<string> {
	switch (toolCall.functionName) {
		case "ripgrep": {
			const pattern = toolCall.parameters.pattern || ""
			const searchPath = toolCall.parameters.path || "."
			const glob = toolCall.parameters.glob
			return executeRipgrep(cwd, pattern, searchPath, glob)
		}
		case "read": {
			const filePath = toolCall.parameters.path || ""
			const lines = toolCall.parameters.lines
			return readFile(cwd, filePath, lines)
		}
		case "list_directory": {
			const dirPath = toolCall.parameters.path || "."
			return listDirectory(cwd, dirPath)
		}
		default:
			return `Error: Unknown function ${toolCall.functionName}`
	}
}

/**
 * Parse finish call and read the specified file ranges.
 */
async function handleFinish(cwd: string, filesParam: string): Promise<string> {
	const fileSpecs = filesParam.split("\n").filter((line) => line.trim())
	const results: string[] = []

	for (const spec of fileSpecs) {
		const parts = spec.split(":")
		const filePath = parts[0].trim()

		if (parts.length === 1 || parts[1].trim() === "*") {
			// Read entire file
			const content = await readFile(cwd, filePath)
			results.push(`=== ${filePath} ===\n${content}`)
		} else {
			// Read specific ranges
			const ranges = parts[1].split(",")
			const rangeContents: string[] = []

			for (const range of ranges) {
				const content = await readFile(cwd, filePath, range.trim())
				rangeContents.push(content)
			}

			results.push(`=== ${filePath} ===\n${rangeContents.join("\n...\n")}`)
		}
	}

	return results.join("\n\n")
}

/**
 * Execute a WarpGrep search against the codebase.
 */
export async function executeWarpGrepSearch(
	cwd: string,
	query: string,
	apiKey: string,
	_clineIgnoreController?: ClineIgnoreController,
): Promise<WarpGrepResult> {
	try {
		// Build repo structure
		const repoStructure = await buildRepoStructure(cwd)

		// Build initial message
		const initialMessage = `<repo_structure>\n${repoStructure}\n</repo_structure>\n\n<search_string>\n${query}\n</search_string>`

		const messages: WarpGrepMessage[] = [{ role: "user", content: initialMessage }]

		let totalChars = initialMessage.length
		let turnsUsed = 0

		for (let turn = 0; turn < MAX_TURNS; turn++) {
			turnsUsed = turn + 1

			// Call the WarpGrep API
			const response = await fetch(WARPGREP_API_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: WARPGREP_MODEL,
					messages: messages.map((m) => ({ role: m.role, content: m.content })),
					temperature: 0.0,
					max_tokens: 2048,
				}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				return {
					success: false,
					content: "",
					turnsUsed,
					error: `WarpGrep API error (${response.status}): ${errorText}`,
				}
			}

			const data = (await response.json()) as {
				choices: Array<{ message: { content: string } }>
			}

			const assistantContent = data.choices?.[0]?.message?.content || ""
			messages.push({ role: "assistant", content: assistantContent })
			totalChars += assistantContent.length

			// Parse tool calls
			const toolCalls = parseToolCalls(assistantContent)

			// Check for finish call
			const finishCall = toolCalls.find((tc) => tc.functionName === "finish")
			if (finishCall) {
				const filesParam = finishCall.parameters.files || ""
				const result = await handleFinish(cwd, filesParam)
				return {
					success: true,
					content: result,
					turnsUsed,
				}
			}

			// If no tool calls, the model is done (shouldn't happen normally)
			if (toolCalls.length === 0) {
				return {
					success: true,
					content: assistantContent,
					turnsUsed,
				}
			}

			// Execute tool calls and build response
			const toolResponses: string[] = []
			for (const toolCall of toolCalls) {
				const result = await executeToolCall(cwd, toolCall)
				toolResponses.push(`<tool_response>\n${result}\n</tool_response>`)
				totalChars += result.length
			}

			const budgetUsed = Math.round((totalChars / CONTEXT_BUDGET_CHARS) * 100)
			const turnCounter = `You have used ${turnsUsed} turns and have ${MAX_TURNS - turnsUsed} remaining.`
			const contextBudget = `<context_budget>${budgetUsed}% (${totalChars}/${CONTEXT_BUDGET_CHARS} chars)</context_budget>`

			const userResponse = `${toolResponses.join("\n\n")}\n\n${turnCounter}\n${contextBudget}`
			messages.push({ role: "user", content: userResponse })
			totalChars += userResponse.length
		}

		// Max turns reached without finish
		return {
			success: true,
			content: "WarpGrep search completed but did not produce a final result within the turn limit.",
			turnsUsed,
		}
	} catch (error) {
		Logger.error("WarpGrep search failed:", error)
		return {
			success: false,
			content: "",
			turnsUsed: 0,
			error: `WarpGrep search failed: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}
