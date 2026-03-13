import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import type { PromptItem, PromptsCatalog } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"

const GITHUB_API_BASE = "https://api.github.com"
const RAW_CONTENT_BASE = "https://raw.githubusercontent.com/cline/prompts/main"
const REPO_OWNER = "cline"
const REPO_NAME = "prompts"

// Maps repo directory prefixes to prompt types
const DIRECTORY_TYPE_MAP: Record<string, "rule" | "workflow" | "hook" | "skill"> = {
	".clinerules/": "rule",
	"workflows/": "workflow",
	"hooks/": "hook",
	"skills/": "skill",
}

/**
 * Minimal YAML frontmatter parser.
 * Extracts key-value pairs from YAML frontmatter delimited by `---`.
 * Handles strings, numbers, and simple arrays like ["a", "b"].
 */
function parseFrontmatter(content: string): Record<string, unknown> {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
	if (!match) return {}

	const yamlBlock = match[1]
	const result: Record<string, unknown> = {}

	for (const line of yamlBlock.split("\n")) {
		const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/)
		if (!kvMatch) continue

		const key = kvMatch[1]
		let value: unknown = kvMatch[2].trim()

		// Parse arrays: ["tag1", "tag2"]
		if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
			try {
				value = JSON.parse(value)
			} catch {
				// Try parsing as YAML-style array
				value = (value as string)
					.slice(1, -1)
					.split(",")
					.map((s) => s.trim().replace(/^["']|["']$/g, ""))
					.filter(Boolean)
			}
		}
		// Strip surrounding quotes
		else if (typeof value === "string" && /^["'].*["']$/.test(value)) {
			value = value.slice(1, -1)
		}

		result[key] = value
	}

	return result
}

/**
 * Resolves author name from a string that might be a GitHub URL.
 */
function resolveAuthorName(author: string): string {
	try {
		const url = new URL(author.startsWith("http") ? author : `https://${author}`)
		if (url.hostname === "github.com" || url.hostname === "www.github.com") {
			const segments = url.pathname.split("/").filter(Boolean)
			if (segments.length > 0) return segments[0]
		}
	} catch {
		// Not a URL, use as-is
	}
	return author
}

interface GitTreeEntry {
	path: string
	mode: string
	type: string
	sha: string
	url: string
}

/**
 * Service for fetching and managing prompts from the cline/prompts GitHub repository.
 *
 * Uses the Git Tree API (1 rate-limited call) to discover all files, then fetches
 * raw content from the CDN (not rate-limited) to parse YAML frontmatter for metadata.
 */
export class PromptsService {
	private cachedCatalog: PromptsCatalog | null = null
	private lastFetchTime = 0
	private readonly CACHE_DURATION = 60 * 60 * 1000 // 1 hour

	/**
	 * Wrapper for HTTP GET requests. Protected to allow test stubbing.
	 */
	protected async httpGet(url: string, headers?: Record<string, string>) {
		return axios.get(url, {
			...getAxiosSettings(),
			timeout: 15_000,
			headers: {
				Accept: "application/vnd.github.v3+json",
				...headers,
			},
		})
	}

	/**
	 * Fetches raw file content from the GitHub CDN (not rate-limited).
	 * Protected to allow test stubbing.
	 */
	protected async fetchRawContent(filePath: string): Promise<string> {
		const url = `${RAW_CONTENT_BASE}/${filePath}`
		const response = await axios.get(url, {
			...getAxiosSettings(),
			timeout: 10_000,
			responseType: "text",
		})
		return typeof response.data === "string" ? response.data : String(response.data)
	}

	/**
	 * Fetches the date of the last commit that modified a file.
	 * Uses the GitHub Commits API (rate-limited). Returns empty string on failure.
	 * Protected to allow test stubbing.
	 */
	protected async fetchLastCommitDate(filePath: string): Promise<string> {
		try {
			const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${encodeURIComponent(filePath)}&per_page=1`
			const response = await this.httpGet(url)
			const commits = response.data
			if (Array.isArray(commits) && commits.length > 0) {
				return commits[0]?.commit?.author?.date || ""
			}
		} catch (error) {
			Logger.error(`Error fetching commit date for ${filePath}:`, error)
		}
		return ""
	}

	/**
	 * Fetches the prompts catalog from the cline/prompts GitHub repository.
	 *
	 * 1. Uses the Git Tree API (1 rate-limited call) to list all files
	 * 2. Fetches raw content from CDN (not rate-limited) for each markdown file
	 * 3. Parses YAML frontmatter for metadata (author, version, description, etc.)
	 */
	async fetchPromptsCatalog(): Promise<PromptsCatalog> {
		// Return cached catalog if still fresh
		const now = Date.now()
		if (this.cachedCatalog && now - this.lastFetchTime < this.CACHE_DURATION) {
			return this.cachedCatalog
		}

		try {
			// Step 1: Get all files via Git Tree API (single rate-limited call)
			const treeUrl = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/main?recursive=1`
			const treeResponse = await this.httpGet(treeUrl)
			const entries: GitTreeEntry[] = treeResponse.data?.tree || []

			// Filter to markdown files in known directories
			const markdownFiles = entries.filter((entry) => {
				if (entry.type !== "blob" || !entry.path.toLowerCase().endsWith(".md")) return false
				return Object.keys(DIRECTORY_TYPE_MAP).some((prefix) => entry.path.startsWith(prefix))
			})

			// Step 2: Fetch raw content from CDN and parse frontmatter (parallel, not rate-limited)
			const items = await Promise.all(
				markdownFiles.map(async (entry) => {
					try {
						return await this.processFile(entry.path)
					} catch (error) {
						Logger.error(`Error processing ${entry.path}:`, error)
						return null
					}
				}),
			)

			const catalog: PromptsCatalog = {
				items: items.filter((item): item is PromptItem => item !== null),
				lastUpdated: new Date().toISOString(),
			}

			// Cache the result
			this.cachedCatalog = catalog
			this.lastFetchTime = now

			return catalog
		} catch (error) {
			Logger.error("Error in fetchPromptsCatalog:", error)
			return {
				items: [],
				lastUpdated: new Date().toISOString(),
			}
		}
	}

	/**
	 * Processes a single file: fetches content from CDN, parses frontmatter,
	 * and fetches the last commit date from the GitHub Commits API.
	 */
	private async processFile(filePath: string): Promise<PromptItem | null> {
		// Determine prompt type from directory
		let promptType: "rule" | "workflow" | "hook" | "skill" | null = null
		for (const [prefix, type] of Object.entries(DIRECTORY_TYPE_MAP)) {
			if (filePath.startsWith(prefix)) {
				promptType = type
				break
			}
		}
		if (!promptType) return null

		// Fetch raw content (CDN, not rate-limited) and commit date (API, rate-limited) in parallel
		const [content, lastCommitDate] = await Promise.all([this.fetchRawContent(filePath), this.fetchLastCommitDate(filePath)])

		// Parse YAML frontmatter
		const frontmatter = parseFrontmatter(content)

		const fileName = filePath.split("/").pop() || ""
		const promptId = fileName.replace(/\.md$/, "")

		// Resolve author
		let authorName = "Unknown"
		const fmAuthor = typeof frontmatter.author === "string" ? frontmatter.author.trim() : ""
		if (fmAuthor) {
			authorName = resolveAuthorName(fmAuthor)
		}

		// Resolve version
		const version = frontmatter.version != null ? String(frontmatter.version).trim() : ""

		return {
			promptId,
			githubUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/${filePath}`,
			name: promptId.replace(/-/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
			author: authorName,
			description:
				typeof frontmatter.description === "string" && frontmatter.description.trim()
					? frontmatter.description.trim()
					: "No description available",
			category:
				typeof frontmatter.category === "string" && frontmatter.category.trim() ? frontmatter.category.trim() : "General",
			tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
			type: promptType,
			content, // Include full content for apply
			version,
			globs: Array.isArray(frontmatter.globs) ? frontmatter.globs.map(String) : [],
			createdAt: lastCommitDate,
			updatedAt: lastCommitDate,
		}
	}
}
