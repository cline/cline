import { spawn } from "node:child_process"
import { extractFileContent } from "@/integrations/misc/extract-file-content"
import { regexSearchFiles } from "@/services/ripgrep"
import { GeneralToolResult } from "@/shared/cline/subagent"
import { Logger } from "@/shared/services/Logger"
import { webfetch } from "../task/tools/handlers/WebFetchToolHandler"
import { TaskConfig } from "../task/tools/types/TaskConfig"
import { resolveWorkspacePath } from "../workspace"

export type SubAgentToolResult = GeneralToolResult[]

export interface SubAgentToolDefinition {
	title: string
	tag: string
	instruction: string
	placeholder: string
	examples?: string[]
	execute: (inputs: string[], taskConfig: TaskConfig) => Promise<SubAgentToolResult>
}

const FILE_READ_TIMEOUT_MS = 10_000 // 10 second timeout per file read

const TOOLFILE: SubAgentToolDefinition = {
	title: "TOOLFILE",
	tag: "name",
	instruction:
		"To retrieve full content of a codebase file using absolute path filename-DO NOT retrieve files that may contain secrets",
	placeholder: "ABSOLUTE_PATH",
	examples: [`See the content of different files: \`<TOOLFILE><name>path/foo.ts</name><name>path/bar.ts</name></TOOLFILE>\``],
	execute: async (filePaths: string[], taskConfig: TaskConfig): Promise<SubAgentToolResult> => {
		const fileReadPromises = filePaths.map(async (filePath): Promise<GeneralToolResult> => {
			try {
				// Create a timeout promise to prevent hanging on large/problematic files
				const timeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(
						() => reject(new Error(`File read timed out after ${FILE_READ_TIMEOUT_MS}ms`)),
						FILE_READ_TIMEOUT_MS,
					)
				})

				// Create the actual file read promise
				const readPromise = (async () => {
					// Resolve the file path relative to the workspace
					const pathResult = resolveWorkspacePath(taskConfig, filePath, "SubAgent.executeParallelFileReads")
					const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath

					// Read the file content
					const supportsImages = taskConfig.api.getModel().info.supportsImages ?? false
					return await extractFileContent(absolutePath, supportsImages)
				})()

				// Race between file read and timeout
				const fileContent = await Promise.race([readPromise, timeoutPromise])

				Logger.info(`Read file content for "${filePath}" successfully.`)

				return {
					agent: "TOOLFILE",
					query: filePath,
					result: fileContent.text,
					success: true,
				}
			} catch (error) {
				Logger.error(`File read failed for "${filePath}": ${error instanceof Error ? error.message : String(error)}`)
				return {
					agent: "TOOLFILE",
					query: filePath,
					result: "",
					error: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
					success: false,
				}
			}
		})

		return await Promise.all(fileReadPromises)
	},
}

const TOOLSEARCH: SubAgentToolDefinition = {
	title: "TOOLSEARCH",
	tag: "query",
	instruction:
		"Perform regex pattern searches across the codebase. Supports multiple parallel searches by including multiple query tags. All searches will execute simultaneously for faster results",
	placeholder: "SEARCH_QUERY",
	examples: [
		`Single search: \`<TOOLSEARCH><query>symbol name</query></TOOLSEARCH>\``,
		`Single search with REGEX query: \`<TOOLSEARCH><query>class \w+Handler.*ApiHandler|export.*ApiHandler|ApiProvider|ModelProvider</query></TOOLSEARCH>\``,
		`Multiple parallel searches: \`<TOOLSEARCH><query>getController</query></TOOLSEARCH><TOOLSEARCH><query>AuthService</query></TOOLSEARCH>\``,
		`Search for a class definition: \`<TOOLSEARCH><query>class UserController</query></TOOLSEARCH>\``,
	],
	execute: async (queries: string[], taskConfig: TaskConfig): Promise<SubAgentToolResult> => {
		const executeSearch = async (absolutePath: string, query: string): Promise<GeneralToolResult> => {
			try {
				const workspaceResults = await regexSearchFiles(
					taskConfig.cwd,
					absolutePath,
					query,
					undefined,
					taskConfig.services.clineIgnoreController,
					false, // exclude hidden files
				)

				const firstLine = workspaceResults.split("\n")[0]
				// Match either "Found X result(s)" or "Showing first X of X+ results"
				const resultMatch = firstLine.match(/Found (\d+) result|Showing first (\d+) of/)
				const resultCount = resultMatch ? parseInt(resultMatch[1] || resultMatch[2], 10) : 0
				Logger.info(`Search for "${query}" found ${resultCount} results in ${absolutePath}`)
				return {
					agent: "TOOLSEARCH",
					query,
					result: workspaceResults,
					success: resultCount > 0,
				}
			} catch (error) {
				Logger.error(`Search failed in ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`)
				return {
					agent: "TOOLSEARCH",
					query,
					result: "",
					error: error instanceof Error ? error.message : String(error),
					success: false,
				}
			}
		}

		const searchPromises = queries.map(async (query): Promise<GeneralToolResult> => {
			try {
				const searchPath = taskConfig.cwd
				return await executeSearch(searchPath, query)
			} catch (error) {
				Logger.error(`Search failed for query "${query}": ${error instanceof Error ? error.message : String(error)}`)
				return {
					agent: "TOOLSEARCH",
					query,
					result: "",
					error: error instanceof Error ? error.message : String(error),
					success: false,
				}
			}
		})

		return await Promise.all(searchPromises)
	},
}

const TOOLBASH: SubAgentToolDefinition = {
	title: "TOOLBASH",
	tag: "command",
	instruction:
		"Run an arbitrary terminal command at the root of the users project. E.g. `ls -la` for listing files, or `find` for searching latest version of the codebase files locally. The command to run in the root of the users project. Must be shell escaped.",
	placeholder: "COMMAND",
	examples: [
		`Single command: \`<TOOLBASH>ls -la</TOOLBASH>\``,
		`Multiple commands: \`<TOOLBASH>ls -la</TOOLBASH><TOOLBASH>gh pr list</TOOLBASH>\``,
	],
	execute: async (commands: string[], taskConfig: TaskConfig): Promise<SubAgentToolResult> => {
		const results = await Promise.all(
			commands.map(async (command): Promise<GeneralToolResult> => {
				try {
					const result = await runShellCommand(command, { cwd: taskConfig.cwd })
					return {
						agent: "TOOLBASH",
						query: command,
						result: result.stdout,
						success: true,
					}
				} catch (error) {
					Logger.error(
						`Bash command failed for "${command}": ${error instanceof Error ? error.message : String(error)}`,
					)
					return {
						agent: "TOOLBASH",
						query: command,
						result: "",
						error: `Command failed: ${error instanceof Error ? error.message : String(error)}`,
						success: false,
					}
				}
			}),
		)
		return results satisfies SubAgentToolResult
	},
}

export async function runShellCommand(
	command: string,
	options: {
		cwd?: string
		env?: Record<string, string>
	} = {},
): Promise<{ command: string; stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
	const { cwd = process.cwd(), env = process.env } = options
	const timeout = 15_000
	const maxBuffer = 1024 * 1024 * 10
	const encoding = "utf8"

	return new Promise((resolve, reject) => {
		const childProcess = spawn(command, [], {
			shell: true,
			cwd,
			env,
			windowsHide: true,
		})

		let stdout = ""
		let stderr = ""
		let killed = false
		const timeoutId = setTimeout(() => {
			killed = true
			childProcess.kill()
			reject(new Error(`Command timed out after ${timeout}ms`))
		}, timeout)

		let stdoutLength = 0
		let stderrLength = 0

		childProcess.stdout?.on("data", (data: Buffer) => {
			const chunk = data.toString(encoding)
			stdoutLength += chunk.length
			if (stdoutLength > maxBuffer) {
				killed = true
				childProcess.kill()
				reject(new Error("stdout maxBuffer exceeded"))
				return
			}
			stdout += chunk
		})

		childProcess.stderr?.on("data", (data: Buffer) => {
			const chunk = data.toString(encoding)
			stderrLength += chunk.length
			if (stderrLength > maxBuffer) {
				killed = true
				childProcess.kill()
				reject(new Error("stderr maxBuffer exceeded"))
				return
			}
			stderr += chunk
		})

		childProcess.on("error", (error: Error) => {
			clearTimeout(timeoutId)
			reject(new Error(`Failed to start process: ${error.message}`))
		})

		childProcess.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(timeoutId)
			if (killed) {
				return
			}

			const result = { command, stdout, stderr, code, signal }
			if (code === 0) {
				resolve(result)
			} else {
				reject(`Command failed with exit code ${code}${stderr ? `: ${stderr}` : result}`)
			}
		})
	})
}

interface WebFetchInput {
	url: string
	prompt: string
}

const TOOLWEBFETCH: SubAgentToolDefinition = {
	title: "TOOLWEBFETCH",
	tag: "request",
	instruction: `Fetches content from a specified URL and analyzes it using your prompt.
- Takes a URL and analysis prompt as input via JSON object
- Fetches the URL content and processes based on your prompt
- Use this tool when you need to retrieve and analyze web content
- IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead
- The URL must be a fully-formed valid URL
- The prompt must be at least 2 characters
- HTTP URLs will be automatically upgraded to HTTPS
- This tool is read-only and does not modify any files`,
	placeholder: '{"url": "URL", "prompt": "ANALYSIS_PROMPT"}',
	examples: [
		`Fetch and analyze a webpage: \`<TOOLWEBFETCH><request>{"url": "https://example.com/docs", "prompt": "Extract the API endpoints"}</request></TOOLWEBFETCH>\``,
		`Multiple fetches: \`<TOOLWEBFETCH><request>{"url": "https://api.example.com/v1", "prompt": "List all available methods"}</request></TOOLWEBFETCH><TOOLWEBFETCH><request>{"url": "https://docs.example.com", "prompt": "Find authentication instructions"}</request></TOOLWEBFETCH>\``,
	],
	execute: async (inputs: string[], taskConfig: TaskConfig): Promise<SubAgentToolResult> => {
		const fetchPromises = inputs.map(async (input): Promise<GeneralToolResult> => {
			try {
				const parsed: WebFetchInput = JSON.parse(input)
				const { url, prompt } = parsed

				if (!url || typeof url !== "string") {
					throw new Error("Missing or invalid 'url' field")
				}
				if (!prompt || typeof prompt !== "string" || prompt.length < 2) {
					throw new Error("Missing or invalid 'prompt' field (must be at least 2 characters)")
				}

				const result = await webfetch(url, prompt, taskConfig.ulid)

				Logger.info(`Fetched web content for "${url}" with prompt "${prompt}" successfully.`)

				return {
					agent: "TOOLWEBFETCH",
					query: url,
					result,
					success: true,
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				Logger.error(`Web fetch failed for input "${input}": ${errorMsg}`)
				return {
					agent: "TOOLWEBFETCH",
					query: input,
					result: "",
					error: `Error fetching web content: ${errorMsg}`,
					success: false,
				}
			}
		})

		return await Promise.all(fetchPromises)
	},
}

/**
 * Tools configuration for SearchAgent.
 */
export const SEARCH_AGENT_TOOLS: SubAgentToolDefinition[] = [TOOLFILE, TOOLSEARCH]
export const TASK_AGENT_TOOLS: SubAgentToolDefinition[] = [TOOLWEBFETCH, TOOLFILE, TOOLSEARCH, TOOLBASH]
