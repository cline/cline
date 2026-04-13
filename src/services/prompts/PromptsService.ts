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
	private cachedGitHubToken: string | null | undefined = undefined // undefined = not yet resolved

	/**
	 * Resolves a GitHub token for authenticated API requests.
	 * Authenticated requests get 5,000 req/hour vs 60 for unauthenticated.
	 * Checks environment variables first, then falls back to `gh auth token`.
	 * Caches the result (including null for "no token available").
	 * Protected to allow test stubbing.
	 */
	protected resolveGitHubToken(): string | null {
		if (this.cachedGitHubToken !== undefined) {
			return this.cachedGitHubToken
		}

		// Check environment variables
		const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
		if (envToken) {
			this.cachedGitHubToken = envToken
			Logger.info("PromptsService: Using GitHub token from environment variable")
			return envToken
		}

		// Try `gh auth token` (GitHub CLI)
		try {
			const { execSync } = require("child_process")
			const token = execSync("gh auth token", {
				encoding: "utf-8",
				timeout: 5000,
				stdio: ["pipe", "pipe", "pipe"],
			}).trim()
			if (token) {
				this.cachedGitHubToken = token
				Logger.info("PromptsService: Using GitHub token from gh CLI")
				return token
			}
		} catch {
			// gh CLI not available or not authenticated
		}

		this.cachedGitHubToken = null
		Logger.info("PromptsService: No GitHub token available, using unauthenticated requests (60 req/hour)")
		return null
	}

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
			// Use authenticated request if a GitHub token is available (5,000 req/hour vs 60)
			const treeUrl = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/main?recursive=1`
			const token = this.resolveGitHubToken()
			const authHeaders: Record<string, string> = {}
			if (token) {
				authHeaders.Authorization = `token ${token}`
			}
			const treeResponse = await this.httpGet(treeUrl, authHeaders)
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
	 * Processes a single file: fetches content from CDN and parses frontmatter.
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

		// Fetch raw content from CDN (not rate-limited)
		const content = await this.fetchRawContent(filePath)

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
			createdAt: "",
			updatedAt: "",
		}
	}
}
