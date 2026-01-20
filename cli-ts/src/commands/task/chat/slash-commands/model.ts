/**
 * Model command handler
 */

import type { Mode } from "@shared/storage/types"
import { getModelIdForProvider, getModelIdKey } from "../model-utils.js"
import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Handle /model command
 */
export const handleModel: CommandHandler = async (args: string[], ctx: CommandContext): Promise<boolean> => {
	const state = await ctx.controller.getStateToPostToWebview()
	const currentMode: Mode = (state.mode as Mode) || "act"
	const apiConfig = state.apiConfiguration

	// Get current provider for this mode
	const provider = currentMode === "plan" ? apiConfig?.planModeApiProvider : apiConfig?.actModeApiProvider

	const subCmd = args[0]?.toLowerCase()

	if (!subCmd) {
		// Show current model
		const modelId = getModelIdForProvider(apiConfig, provider, currentMode)
		ctx.fmt.raw("")
		ctx.fmt.info(`Mode: ${currentMode}`)
		ctx.fmt.info(`Provider: ${provider || "(not set)"}`)
		ctx.fmt.info(`Model: ${modelId || "(not set)"}`)
		ctx.fmt.raw("")
		return true
	}

	if (subCmd === "list") {
		// Fetch models from OpenRouter if applicable
		if (provider === "openrouter" || provider === "cline") {
			ctx.fmt.info("Fetching models from OpenRouter...")
			try {
				const response = await fetch("https://openrouter.ai/api/v1/models")
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`)
				}
				const data = (await response.json()) as {
					data?: Array<{
						id: string
						name?: string
						pricing?: { prompt?: string; completion?: string }
					}>
				}
				const models = (data.data || []).sort((a, b) => a.id.localeCompare(b.id))

				ctx.fmt.raw("")
				ctx.fmt.info(`Available models (${models.length} total):`)
				ctx.fmt.raw("")

				// Show all models with pricing info (alphabetized)
				for (const model of models) {
					const promptPrice = model.pricing?.prompt
						? `$${(parseFloat(model.pricing.prompt) * 1_000_000).toFixed(2)}/M`
						: "N/A"
					const completionPrice = model.pricing?.completion
						? `$${(parseFloat(model.pricing.completion) * 1_000_000).toFixed(2)}/M`
						: "N/A"
					ctx.fmt.raw(`  ${model.id}`)
					ctx.fmt.raw(`    Input: ${promptPrice}, Output: ${completionPrice}`)
				}

				ctx.fmt.raw("")
				ctx.fmt.info("Use '/model <model-id>' to set the model")
				ctx.fmt.raw("")
			} catch (err) {
				ctx.fmt.error(`Failed to fetch models: ${(err as Error).message}`)
			}
		} else {
			ctx.fmt.warn(`Model listing not available for provider: ${provider || "none"}`)
			ctx.fmt.info("Model listing is only supported for OpenRouter and Cline providers.")
		}
		return true
	}

	// Set model - args is the model ID (may contain slashes like "anthropic/claude-3")
	const newModelId = args.join(" ")

	if (!provider) {
		ctx.fmt.error("No provider configured for current mode.")
		ctx.fmt.info("Run 'cline auth' to configure a provider first.")
		return true
	}

	const modelIdKey = getModelIdKey(provider, currentMode)
	ctx.controller.stateManager.setGlobalState(modelIdKey as any, newModelId)
	await ctx.controller.stateManager.flushPendingState()
	ctx.fmt.success(`Set ${currentMode} mode model to: ${newModelId}`)
	return true
}
