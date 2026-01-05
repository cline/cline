import type { StateManager } from "../../core/storage/StateManager"
import type { QuantrelAgent } from "./types"

/**
 * Quantrel Model Service
 * Handles fetching and caching of available AI models from Quantrel marketplace
 */
export class QuantrelModelService {
	private stateManager: StateManager
	private baseUrl: string
	private cachedAgents: QuantrelAgent[] = []
	private lastFetchTime: number = 0
	private readonly CACHE_DURATION = 60 * 60 * 1000 // 1 hour in milliseconds

	constructor(stateManager: StateManager, baseUrl?: string) {
		this.stateManager = stateManager
		this.baseUrl = baseUrl || "http://localhost:8080"
	}

	/**
	 * Fetch all available agents from Quantrel
	 * Uses cache if data is less than 1 hour old
	 */
	async fetchAgents(forceRefresh: boolean = false): Promise<QuantrelAgent[]> {
		const now = Date.now()

		// Return cached data if still fresh
		if (!forceRefresh && this.cachedAgents.length > 0 && now - this.lastFetchTime < this.CACHE_DURATION) {
			return this.cachedAgents
		}

		const accessToken = this.stateManager.getSecretKey("quantrelAccessToken")

		if (!accessToken) {
			throw new Error("Not authenticated. Please login to Quantrel first.")
		}

		try {
			const response = await fetch(`${this.baseUrl}/api/agents`, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			})

			if (!response.ok) {
				if (response.status === 401) {
					throw new Error("Session expired. Please login again.")
				}
				throw new Error(`Failed to fetch agents: ${response.statusText}`)
			}

			this.cachedAgents = await response.json()
			this.lastFetchTime = now

			return this.cachedAgents
		} catch (error) {
			throw new Error(`Failed to fetch agents: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Search agents by name, publisher, or tags
	 */
	searchAgents(query: string): QuantrelAgent[] {
		const lowerQuery = query.toLowerCase()
		return this.cachedAgents.filter(
			(agent) =>
				agent.name.toLowerCase().includes(lowerQuery) ||
				agent.publisher.toLowerCase().includes(lowerQuery) ||
				agent.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)) ||
				agent.modelId.toLowerCase().includes(lowerQuery),
		)
	}

	/**
	 * Filter agents by capability score
	 */
	filterByCapability(capability: "reasoning" | "intelligence" | "speed", minScore: number): QuantrelAgent[] {
		return this.cachedAgents.filter((agent) => agent[capability] >= minScore)
	}

	/**
	 * Filter agents by publisher
	 */
	filterByPublisher(publisher: string): QuantrelAgent[] {
		return this.cachedAgents.filter((agent) => agent.publisher.toLowerCase() === publisher.toLowerCase())
	}

	/**
	 * Filter agents by tags
	 */
	filterByTags(tags: string[]): QuantrelAgent[] {
		return this.cachedAgents.filter((agent) => tags.some((tag) => agent.tags.includes(tag)))
	}

	/**
	 * Get agent by ID
	 */
	getAgentById(agentId: number): QuantrelAgent | undefined {
		return this.cachedAgents.find((agent) => agent.id === agentId)
	}

	/**
	 * Get agent by model ID (e.g., "anthropic/claude-sonnet-4.5")
	 */
	getAgentByModelId(modelId: string): QuantrelAgent | undefined {
		return this.cachedAgents.find((agent) => agent.modelId === modelId)
	}

	/**
	 * Sort agents by price (ascending)
	 */
	sortByPrice(agents?: QuantrelAgent[]): QuantrelAgent[] {
		const toSort = agents || this.cachedAgents
		return [...toSort].sort((a, b) => {
			const aTotalPrice = a.inputPrice + a.outputPrice
			const bTotalPrice = b.inputPrice + b.outputPrice
			return aTotalPrice - bTotalPrice
		})
	}

	/**
	 * Sort agents by capability score (descending)
	 */
	sortByCapability(capability: "reasoning" | "intelligence" | "speed", agents?: QuantrelAgent[]): QuantrelAgent[] {
		const toSort = agents || this.cachedAgents
		return [...toSort].sort((a, b) => b[capability] - a[capability])
	}

	/**
	 * Get recommended agents for coding tasks
	 */
	getRecommendedForCoding(): QuantrelAgent[] {
		return this.cachedAgents
			.filter(
				(agent) =>
					agent.intelligence >= 7 &&
					agent.reasoning >= 7 &&
					(agent.tags.includes("coding") ||
						agent.tags.includes("programming") ||
						agent.name.toLowerCase().includes("code") ||
						agent.name.toLowerCase().includes("claude") ||
						agent.name.toLowerCase().includes("gpt")),
			)
			.sort((a, b) => b.intelligence - a.intelligence)
	}

	/**
	 * Get fastest agents (good for quick queries)
	 */
	getFastestAgents(minSpeed: number = 7): QuantrelAgent[] {
		return this.cachedAgents.filter((agent) => agent.speed >= minSpeed).sort((a, b) => b.speed - a.speed)
	}

	/**
	 * Get most intelligent agents
	 */
	getMostIntelligent(minIntelligence: number = 8): QuantrelAgent[] {
		return this.cachedAgents
			.filter((agent) => agent.intelligence >= minIntelligence)
			.sort((a, b) => b.intelligence - a.intelligence)
	}

	/**
	 * Get cheapest agents
	 */
	getCheapestAgents(maxTotalPrice: number = 1.0): QuantrelAgent[] {
		return this.cachedAgents
			.filter((agent) => agent.inputPrice + agent.outputPrice <= maxTotalPrice)
			.sort((a, b) => {
				const aTotalPrice = a.inputPrice + a.outputPrice
				const bTotalPrice = b.inputPrice + b.outputPrice
				return aTotalPrice - bTotalPrice
			})
	}

	/**
	 * Calculate estimated cost for a message
	 */
	estimateCost(agent: QuantrelAgent, inputTokens: number, outputTokens: number): number {
		const inputCost = (inputTokens / 1_000_000) * agent.inputPrice
		const outputCost = (outputTokens / 1_000_000) * agent.outputPrice
		return inputCost + outputCost
	}

	/**
	 * Get cached agents count
	 */
	getCachedAgentsCount(): number {
		return this.cachedAgents.length
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.cachedAgents = []
		this.lastFetchTime = 0
	}

	/**
	 * Get all unique publishers
	 */
	getPublishers(): string[] {
		const publishers = new Set(this.cachedAgents.map((agent) => agent.publisher))
		return Array.from(publishers).sort()
	}

	/**
	 * Get all unique tags
	 */
	getTags(): string[] {
		const tags = new Set(this.cachedAgents.flatMap((agent) => agent.tags))
		return Array.from(tags).sort()
	}
}
