import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import type { PromptItem, PromptsCatalog } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"

/**
 * Service for fetching and managing prompts from GitHub
 */
export class PromptsService {
	private readonly PROMPTS_REPO_API = "https://api.github.com/repos/cline/prompts/contents"
	private readonly PROMPTS_COMMITS_API = "https://api.github.com/repos/cline/prompts/commits"
	private cachedCatalog: PromptsCatalog | null = null
	private lastFetchTime = 0
	private readonly CACHE_DURATION = 60 * 60 * 1000 // 1 hour

	/**
	 * Wrapper for HTTP GET requests. Protected to allow test stubbing.
	 */
	protected async httpGet(url: string) {
		return axios.get(url, getAxiosSettings())
	}

	/**
	 * Fetches the prompts catalog from GitHub
	 */
	async fetchPromptsCatalog(): Promise<PromptsCatalog> {
		// Return cached catalog if still fresh
		const now = Date.now()
		if (this.cachedCatalog && now - this.lastFetchTime < this.CACHE_DURATION) {
			return this.cachedCatalog
		}

		try {
			// Fetch all directories in parallel for faster loading
			const [rulesItems, workflowItems, hookItems, skillItems] = await Promise.all([
				this.fetchPromptsFromDirectory(".clinerules", "rule"),
				this.fetchPromptsFromDirectory("workflows", "workflow"),
				this.fetchPromptsFromDirectory("hooks", "hook"),
				this.fetchPromptsFromDirectory("skills", "skill"),
			])

			const items: PromptItem[] = [...rulesItems, ...workflowItems, ...hookItems, ...skillItems]

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
	 * Fetches prompts from a specific directory in the GitHub repo
	 * Uses parallel fetching with batching for improved performance
	 */
	private async fetchPromptsFromDirectory(
		directory: string,
		type: "rule" | "workflow" | "hook" | "skill",
	): Promise<PromptItem[]> {
		try {
			const url = `${this.PROMPTS_REPO_API}/${directory}`
			const response = await this.httpGet(url)

			if (!Array.isArray(response.data)) {
				return []
			}

			// Filter to only .md files
			const mdFiles = response.data.filter(
				(file: { name: string; type: string }) => file.name.endsWith(".md") && file.type === "file",
			)

			// Fetch all file contents in parallel (batched to respect rate limits)
			const BATCH_SIZE = 10
			const items: PromptItem[] = []

			for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
				const batch = mdFiles.slice(i, i + BATCH_SIZE)
				const batchResults = await Promise.all(
					batch.map(async (file: { name: string; download_url: string; html_url: string }) => {
						try {
							const contentResponse = await this.httpGet(file.download_url)
							return { file, content: contentResponse.data }
						} catch (error) {
							Logger.error(`Error fetching prompt ${file.name}:`, error)
							return null
						}
					}),
				)

				// Process successful fetches
				for (const result of batchResults) {
					if (!result) continue

					const { file, content } = result
					const item = this.parsePromptContent(file, content, type)
					if (item) {
						items.push(item)
					}
				}
			}

			// Backfill commit dates for items missing createdAt/updatedAt from frontmatter
			const itemsNeedingDates = items.filter((item) => !item.createdAt)
			if (itemsNeedingDates.length > 0) {
				await this.backfillCommitDates(itemsNeedingDates, directory)
			}

			return items
		} catch (error) {
			Logger.error(`Error fetching directory ${directory}:`, error)
			return []
		}
	}

	/**
	 * Fetches commit dates from the GitHub Commits API for items missing dates.
	 * Uses batched parallel requests. Failures are silently ignored (dates remain empty).
	 */
	private async backfillCommitDates(items: PromptItem[], directory: string): Promise<void> {
		const BATCH_SIZE = 5
		for (let i = 0; i < items.length; i += BATCH_SIZE) {
			const batch = items.slice(i, i + BATCH_SIZE)
			await Promise.all(
				batch.map(async (item) => {
					try {
						const filePath = `${directory}/${item.promptId}.md`
						const commitsUrl = `${this.PROMPTS_COMMITS_API}?path=${encodeURIComponent(filePath)}&per_page=100`
						const response = await this.httpGet(commitsUrl)

						if (Array.isArray(response.data) && response.data.length > 0) {
							// First element = most recent commit = updatedAt
							const latestCommit = response.data[0]
							if (latestCommit?.commit?.author?.date) {
								item.updatedAt = latestCommit.commit.author.date
							}

							// Last element = first commit = createdAt
							const oldestCommit = response.data[response.data.length - 1]
							if (oldestCommit?.commit?.author?.date) {
								item.createdAt = oldestCommit.commit.author.date
							}
						}
					} catch (error) {
						// Silently ignore — dates will remain empty (displayed as "—")
						Logger.debug?.(`Could not fetch commit dates for ${item.promptId}: ${error}`)
					}
				}),
			)
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
