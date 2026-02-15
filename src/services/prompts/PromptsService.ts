import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import type { PromptItem, PromptsCatalog } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"

/**
 * Service for fetching and managing prompts from GitHub
 */
export class PromptsService {
	private readonly PROMPTS_REPO_API = "https://api.github.com/repos/cline/prompts/contents"
	private cachedCatalog: PromptsCatalog | null = null
	private lastFetchTime = 0
	private readonly CACHE_DURATION = 60 * 60 * 1000 // 1 hour

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
			// Fetch both directories in parallel for faster loading
			const [rulesItems, workflowItems] = await Promise.all([
				this.fetchPromptsFromDirectory(".clinerules", "rule"),
				this.fetchPromptsFromDirectory("workflows", "workflow"),
			])

			const items: PromptItem[] = [...rulesItems, ...workflowItems]

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
	private async fetchPromptsFromDirectory(directory: string, type: "rule" | "workflow"): Promise<PromptItem[]> {
		try {
			const url = `${this.PROMPTS_REPO_API}/${directory}`
			const response = await axios.get(url, getAxiosSettings())

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
							const contentResponse = await axios.get(file.download_url, getAxiosSettings())
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

			return items
		} catch (error) {
			Logger.error(`Error fetching directory ${directory}:`, error)
			return []
		}
	}

	/**
	 * Parses prompt content and extracts metadata from frontmatter
	 */
	private parsePromptContent(
		file: { name: string; html_url: string },
		content: string,
		type: "rule" | "workflow",
	): PromptItem | null {
		try {
			// Parse frontmatter (basic implementation)
			const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
			let description = ""
			let author = ""
			let category = ""
			const tags: string[] = []

			if (frontmatterMatch) {
				const frontmatter = frontmatterMatch[1]
				const descMatch = frontmatter.match(/description:\s*["']?(.*?)["']?(?:\n|$)/)
				const authorMatch = frontmatter.match(/author:\s*["']?(.*?)["']?(?:\n|$)/)
				const categoryMatch = frontmatter.match(/category:\s*["']?(.*?)["']?(?:\n|$)/)
				const tagsMatch = frontmatter.match(/tags:\s*\[(.*?)\]/)

				if (descMatch) description = descMatch[1]
				if (authorMatch) author = authorMatch[1]
				if (categoryMatch) category = categoryMatch[1]
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
				const githubMatch = author.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#()>\]]+)/i)
				if (githubMatch) {
					authorName = githubMatch[1]
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
				version: "1.0",
				globs: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}
		} catch (error) {
			Logger.error(`Error parsing prompt ${file.name}:`, error)
			return null
		}
	}
}
