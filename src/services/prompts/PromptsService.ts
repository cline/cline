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
			const items: PromptItem[] = []

			// Fetch .clinerules directory
			const rulesItems = await this.fetchPromptsFromDirectory(".clinerules", "rule")
			items.push(...rulesItems)

			// Fetch workflows directory
			const workflowItems = await this.fetchPromptsFromDirectory("workflows", "workflow")
			items.push(...workflowItems)

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
	 */
	private async fetchPromptsFromDirectory(directory: string, type: "rule" | "workflow"): Promise<PromptItem[]> {
		try {
			const url = `${this.PROMPTS_REPO_API}/${directory}`
			const response = await axios.get(url, getAxiosSettings())

			if (!Array.isArray(response.data)) {
				return []
			}

			const items: PromptItem[] = []

			// Fetch each .md file
			for (const file of response.data) {
				if (file.name.endsWith(".md") && file.type === "file") {
					try {
						// Fetch the raw content
						const contentResponse = await axios.get(file.download_url, getAxiosSettings())
						const content = contentResponse.data

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

						items.push({
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
						})
					} catch (error) {
						// biome-ignore lint/suspicious/noConsole: Service logging
						Logger.error(`Error fetching prompt ${file.name}:`, error)
						// Skip this file and continue
					}
				}
			}

			return items
		} catch (error) {
			// biome-ignore lint/suspicious/noConsole: Service logging
			Logger.error(`Error fetching directory ${directory}:`, error)
			return []
		}
	}
}
