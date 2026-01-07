import { extractFileContent } from "@/integrations/misc/extract-file-content"
import { Logger } from "@/services/logging/Logger"
import { regexSearchFiles } from "@/services/ripgrep"
import { FileReadResult, SearchResult } from "@/shared/cline/subagent"
import { TaskConfig } from "../task/tools/types/TaskConfig"
import { resolveWorkspacePath } from "../workspace"

export type SubAgentToolResult = FileReadResult[] | SearchResult[]

export interface SubAgentToolDefinition {
	title: string
	tag: string
	instruction: string
	placeholder: string
	examples?: string[]
	execute: (inputs: string[], taskConfig: TaskConfig) => Promise<SubAgentToolResult>
}

const TOOLFILE: SubAgentToolDefinition = {
	title: "TOOLFILE",
	tag: "name",
	instruction:
		"To retrieve full content of a codebase file using absolute path filename-DO NOT retrieve files that may contain secrets",
	placeholder: "ABSOLUTE_PATH",
	examples: [`See the content of different files: \`<TOOLFILE><name>path/foo.ts</name><name>path/bar.ts</name></TOOLFILE>\``],
	execute: async (filePaths: string[], taskConfig: TaskConfig): Promise<SubAgentToolResult> => {
		const fileReadPromises = filePaths.map(async (filePath) => {
			try {
				// Resolve the file path relative to the workspace
				const pathResult = resolveWorkspacePath(taskConfig, filePath, "SubAgent.executeParallelFileReads")
				const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath

				// Read the file content
				const supportsImages = taskConfig.api.getModel().info.supportsImages ?? false
				const fileContent = await extractFileContent(absolutePath, supportsImages)

				Logger.info(`Read file content for "${filePath}" successfully.`)

				return {
					path: filePath,
					content: fileContent.text,
					success: true,
				}
			} catch (error) {
				Logger.error(`File read failed for "${filePath}": ${error instanceof Error ? error.message : String(error)}`)
				return {
					path: filePath,
					content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
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
		const executeSearch = async (absolutePath: string, query: string) => {
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
					query,
					workspaceResults,
					resultCount,
					success: true,
				}
			} catch (error) {
				Logger.error(`Search failed in ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`)
				return {
					query,
					workspaceResults: "",
					resultCount: 0,
					success: false,
				}
			}
		}

		const searchPromises = queries.map(async (query) => {
			try {
				const searchPath = taskConfig.cwd
				return await executeSearch(searchPath, query)
			} catch (error) {
				Logger.error(`Search failed for query "${query}": ${error instanceof Error ? error.message : String(error)}`)
				return {
					query,
					workspaceResults: "",
					resultCount: 0,
					success: false,
				}
			}
		})

		return await Promise.all(searchPromises)
	},
}

/**
 * Tools configuration for SearchAgent.
 */
export const SEARCH_AGENT_TOOLS: SubAgentToolDefinition[] = [TOOLFILE, TOOLSEARCH]
