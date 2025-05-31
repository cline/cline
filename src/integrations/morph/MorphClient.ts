import OpenAI from "openai"

export class MorphClient {
	private client: OpenAI

	constructor() {
		const apiKey = process.env.MORPH_API_KEY // TODO: Just been hardcoding this for now
		if (!apiKey) {
			throw new Error("MORPH_API_KEY environment variable is required")
		}

		this.client = new OpenAI({
			apiKey,
			baseURL: "https://api.morphllm.com/v1",
		})
	}

	async applyEdit(originalCode: string, codeEdit: string): Promise<string> {
		try {
			const response = await this.client.chat.completions.create({
				model: "morph-v2",
				messages: [
					{
						role: "user",
						content: `<code>${originalCode}</code>\n<update>${codeEdit}</update>`,
					},
				],
				stream: false,
			})

			const updatedCode = response.choices[0]?.message?.content
			if (!updatedCode) {
				throw new Error("No response from Morph API")
			}

			return updatedCode
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Morph API error: ${error.message}`)
			}
			throw new Error("Unknown error occurred while calling Morph API")
		}
	}
} 