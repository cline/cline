import OpenAI from "openai"

export interface MorphApplyResult {
	success: boolean
	content?: string
	error?: string
}

export async function applyMorphEdit(originalCode: string, updatedCode: string, apiKey: string): Promise<MorphApplyResult> {
	try {
		if (!apiKey) {
			return {
				success: false,
				error: "MORPH_API_KEY is not configured",
			}
		}

		const openai = new OpenAI({
			apiKey: apiKey,
			baseURL: "https://api.morphllm.com/v1",
		})

		const response = await openai.chat.completions.create({
			model: "auto", // Use 'auto' for intelligent routing based on complexity
			messages: [
				{
					role: "user",
					content: `<code>${originalCode}</code>\n<update>${updatedCode}</update>`,
				},
			],
		})

		const content = response.choices[0]?.message?.content
		if (!content) {
			return {
				success: false,
				error: "No content received from Morph API",
			}
		}

		return {
			success: true,
			content: content,
		}
	} catch (error) {
		let errorMessage = "Unknown error occurred"

		if (error instanceof Error) {
			errorMessage = error.message
		} else if (typeof error === "string") {
			errorMessage = error
		}

		// Handle specific API errors
		if (errorMessage.includes("401")) {
			errorMessage = "Invalid MORPH_API_KEY - please check your API key"
		} else if (errorMessage.includes("429")) {
			errorMessage = "Rate limit exceeded - please try again later"
		} else if (errorMessage.includes("network") || errorMessage.includes("fetch")) {
			errorMessage = "Network error - please check your internet connection"
		}

		return {
			success: false,
			error: errorMessage,
		}
	}
}
