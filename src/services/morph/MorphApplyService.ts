import { errorService } from "@services/error"
import { Logger } from "@services/logging/Logger"
import OpenAI from "openai"
import { DEFAULT_MORPH_API_URL, DEFAULT_MORPH_MODEL } from "@/config"
import { StateManager } from "@/core/storage/StateManager"

export class MorphApplyService {
	private stateManager: StateManager

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager
	}

	/**
	 * Applies a code edit using the Morph API.
	 *
	 * @param initialCode The full original code of the file.
	 * @param instructions A single sentence instruction describing the change.
	 * @param codeEdit The abbreviated code snippet representing the change.
	 * @returns The fully merged code after applying the edit, or an "Error: ..." string on failure.
	 */
	public async applyEdit(initialCode: string, instructions: string, codeEdit: string): Promise<string> {
		// Use getApiConfiguration for consistency, although direct accessors are also viable here.
		const { morphApiKey, morphApiUrl } = this.stateManager.getApiConfiguration()
		const apiKey = morphApiKey
		const baseUrl = morphApiUrl || DEFAULT_MORPH_API_URL

		// Basic debug to verify Morph path engagement and input sizes
		Logger.debug(
			`[MorphApplyService] applyEdit invoked (model=${DEFAULT_MORPH_MODEL}, baseUrl=${baseUrl}); sizes: initialCode=${initialCode?.length ?? 0}, instructions=${instructions?.length ?? 0}, codeEdit=${codeEdit?.length ?? 0}`,
		)

		if (!apiKey) {
			// We return an error string instead of throwing, so the tool handler can manage the fallback logic.
			Logger.warn("[MorphApplyService] Morph API key is not configured.")
			return "Error: Morph API key is not configured. Please ask the user to configure it in the settings (Code Editing Utilities)."
		}

		const client = new OpenAI({
			apiKey: apiKey,
			baseURL: baseUrl,
		})

		const payload = this.constructPayload(initialCode, instructions, codeEdit)

		try {
			const startMs = Date.now()
			Logger.info(`[MorphApplyService] Calling Morph API at ${baseUrl}`)
			const response = await client.chat.completions.create({
				model: DEFAULT_MORPH_MODEL,
				messages: [
					{
						role: "user",
						content: payload,
					},
				],
				temperature: 0.2, // Recommended temperature for code generation consistency
			})

			const mergedCode = response.choices[0]?.message?.content
			if (mergedCode === null || mergedCode === undefined) {
				throw new Error("Morph API returned null or undefined content.")
			}

			Logger.debug(
				`[MorphApplyService] Morph API succeeded in ${Date.now() - startMs}ms; mergedCode length=${mergedCode.length}`,
			)
			return mergedCode
		} catch (error) {
			const clineError = errorService.toClineError(error, DEFAULT_MORPH_MODEL, "morph")
			errorService.logException(clineError)
			// Return the error message so the tool handler can proceed with fallback.
			return `Error: ${clineError.message}`
		}
	}

	/**
	 * Constructs the specific XML payload required by the Morph API.
	 */
	private constructPayload(initialCode: string, instructions: string, codeEdit: string): string {
		// Use standard string concatenation or template literals, ensuring newlines are correctly inserted.
		return `<instruction>${instructions}</instruction>\n<code>${initialCode}</code>\n<update>${codeEdit}</update>`
	}
}
