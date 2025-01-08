import axios from "axios"

interface UserStory {
	id: string
	title: string
	description: string
	acceptance_criteria: string[]
	status: string
	priority: string
	created_at: string
	updated_at: string
}

interface TechnicalDesign {
	id: string
	title: string
	description: string
	architecture: string
	tech_stack: string[]
	api_endpoints: {
		path: string
		method: string
		description: string
	}[]
	database_schema: string
	created_at: string
	updated_at: string
}

export class OgToolsService {
	private readonly baseUrl = "https://tools-backend.dev.opengig.work/integrations"
	private readonly apiKey: string

	constructor(apiKey: string) {
		this.apiKey = apiKey
	}

	private get headers() {
		return {
			"x-api-key": this.apiKey,
			"Content-Type": "application/json",
		}
	}

	async fetchUserStories(projectName: string): Promise<UserStory[]> {
		try {
			const response = await axios.get<UserStory[]>(`${this.baseUrl}/stories/${encodeURIComponent(projectName)}`, {
				headers: this.headers,
			})
			return response.data
		} catch (error) {
			if (axios.isAxiosError(error)) {
				throw new Error(`Failed to fetch user stories: ${error.response?.data?.message || error.message}`)
			}
			throw error
		}
	}

	async fetchTechnicalDesign(projectName: string): Promise<TechnicalDesign> {
		try {
			const response = await axios.get<TechnicalDesign>(
				`${this.baseUrl}/technical-design/${encodeURIComponent(projectName)}`,
				{ headers: this.headers },
			)
			return response.data
		} catch (error) {
			if (axios.isAxiosError(error)) {
				throw new Error(`Failed to fetch technical design: ${error.response?.data?.message || error.message}`)
			}
			throw error
		}
	}
}
