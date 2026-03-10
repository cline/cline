import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import type { PromptItem, PromptsCatalog } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"

// Maps repo directory prefixes to prompt types
const DIRECTORY_TYPE_MAP: Record<string, "rule" | "workflow" | "hook" | "skill"> = {
	".clinerules/": "rule",
	"workflows/": "workflow",
	"hooks/": "hook",
	"skills/": "skill",
}

/**
 * Service for fetching and managing prompts from GitHub.
 *
 * Uses the Git Trees API to list the entire repo in a single rate-limited call,
 * then fetches file contents from raw.githubusercontent.com (CDN, not rate-limited).
 * This keeps rate-limited API usage to 1 call per catalog fetch.
 */
export class PromptsService {
	private readonly TREE_API = "https://api.github.com/repos/cline/prompts/git/trees/main?recursive=1"
	private readonly RAW_CONTENT_BASE = "https://raw.githubusercontent.com/cline/prompts/main"
	private cachedCatalog: PromptsCatalog | null = null
	private lastFetchTime = 0
	private readonly CACHE_DURATION = 60 * 60 * 1000 // 1 hour

	/**
	 * Wrapper for HTTP GET requests. Protected to allow test stubbing.
	 */
	protected async httpGet(url: string) {
		return axios.get(url, { ...getAxiosSettings(), timeout: 10_000 })
	}

	/**
	 * Fetches the prompts catalog from GitHub using the Git Trees API.
	 * Only 1 rate-limited API call is made; content is fetched from the CDN.
	 */
	async fetchPromptsCatalog(): Promise<PromptsCatalog> {
		// Return cached catalog if still fresh
		const now = Date.now()
		if (this.cachedCatalog && now - this.lastFetchTime < this.CACHE_DURATION) {
			return this.cachedCatalog
		}

		try {
			// 1. Single rate-limited call: get the full repo tree
			const treeResponse = await this.httpGet(this.TREE_API)
			const tree: Array<{ path: string; type: string }> = treeResponse.data?.tree || []

			// 2. Filter to .md files in known directories
			const mdFiles: Array<{ path: string; type: "rule" | "workflow" | "hook" | "skill" }> = []
			for (const entry of tree) {
				if (entry.type !== "blob" || !entry.path.endsWith(".md")) continue

				for (const [prefix, promptType] of Object.entries(DIRECTORY_TYPE_MAP)) {
					if (entry.path.startsWith(prefix)) {
						mdFiles.push({ path: entry.path, type: promptType })
						break
					}
				}
			}

			// 3. Fetch content from raw.githubusercontent.com (CDN, not rate-limited)
			const BATCH_SIZE = 10
			const items: PromptItem[] = []

			for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
				const batch = mdFiles.slice(i, i + BATCH_SIZE)
				const batchResults = await Promise.all(
					batch.map(async ({ path, type }) => {
						try {
							const contentUrl = `${this.RAW_CONTENT_BASE}/${path}`
							const contentResponse = await this.httpGet(contentUrl)
							const fileName = path.split("/").pop() || path
							const htmlUrl = `https://github.com/cline/prompts/blob/main/${path}`
							return {
								file: { name: fileName, html_url: htmlUrl },
								content: contentResponse.data,
								type,
							}
						} catch (error) {
							Logger.error(`Error fetching prompt ${path}:`, error)
							return null
						}
					}),
				)

				for (const result of batchResults) {
					if (!result) continue
					const item = this.parsePromptContent(result.file, result.content, result.type)
					if (item) {
						items.push(item)
					}
				}
			}

			const catalog: PromptsCatalog = {
				items,
				lastUpdated: new Date().toISOString(),
			}

			// Cache the result
			this.cachedCatalog = catalog
			this.lastFetchTime = now

			return catalog
		} catch (error) {
			Logger.error("Error in fetchPromptsCatalog:", error)
			// Return empty catalog on error
			return {
				items: [],
				lastUpdated: new Date().toISOString(),
			}
		}
	}

	/**
	 * Parses prompt content and extracts metadata from frontmatter
	 */
	private parsePromptContent(
		file: { name: string; html_url: string },
		content: string,
		type: "rule" | "workflow" | "hook" | "skill",
	): PromptItem | null {
		try {
			// Parse frontmatter (basic implementation)
			const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
			let description = ""
			let author = ""
			let category = ""
			const tags: string[] = []

			let version = ""
			let createdAt = ""
			let updatedAt = ""

			if (frontmatterMatch) {
				const frontmatter = frontmatterMatch[1]
				const descMatch = frontmatter.match(/description:\s*["']?(.*?)["']?(?:\n|$)/)
				const authorMatch = frontmatter.match(/author:\s*["']?(.*?)["']?(?:\n|$)/)
				const categoryMatch = frontmatter.match(/category:\s*["']?(.*?)["']?(?:\n|$)/)
				const versionMatch = frontmatter.match(/version:\s*["']?(.*?)["']?(?:\n|$)/)
				const createdAtMatch = frontmatter.match(/created_at:\s*["']?(.*?)["']?(?:\n|$)/)
				const updatedAtMatch = frontmatter.match(/updated_at:\s*["']?(.*?)["']?(?:\n|$)/)
				const tagsMatch = frontmatter.match(/tags:\s*\[(.*?)\]/)

				if (descMatch) description = descMatch[1].trim()
				if (authorMatch) author = authorMatch[1].trim()
				if (categoryMatch) category = categoryMatch[1].trim()
				if (versionMatch) version = versionMatch[1].trim()
				if (createdAtMatch) createdAt = createdAtMatch[1].trim()
				if (updatedAtMatch) updatedAt = updatedAtMatch[1].trim()
				if (tagsMatch) {
					const tagContent = tagsMatch[1].trim()
					if (tagContent) {
						tags.push(...tagContent.split(",").map((t: string) => t.trim().replace(/["']/g, "")))
					}
				}
			}

			const promptId = file.name.replace(".md", "")

			// Extract username from GitHub URL if present
			let authorName = author || "Unknown"
			if (author) {
				try {
					const authorUrl = new URL(author.startsWith("http") ? author : `https://${author}`)
					if (authorUrl.hostname === "github.com" || authorUrl.hostname === "www.github.com") {
						const pathSegments = authorUrl.pathname.split("/").filter(Boolean)
						if (pathSegments.length > 0) {
							authorName = pathSegments[0]
						}
					}
				} catch {
					// Not a valid URL, use as-is
				}
			}

			return {
				promptId,
				githubUrl: file.html_url,
				name: promptId.replace(/-/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
				author: authorName,
				description: description || "No description available",
				category: category || "General",
				tags,
				type,
				content,
				version: version || "",
				globs: [],
				createdAt,
				updatedAt,
			}
		} catch (error) {
			Logger.error(`Error parsing prompt ${file.name}:`, error)
			return null
		}
	}
}
