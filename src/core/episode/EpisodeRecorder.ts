import { Anthropic } from "@anthropic-ai/sdk"
import crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"

export interface EpisodeData {
	input: Anthropic.Messages.MessageParam[]
	model: string
	provider: string
	temperature?: number
	response: {
		text: string
		toolUses: any[]
	}
	startTime: Date
	usage: {
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
	}
	totalCost?: number
}

/**
 * Records API request/response pairs as episodes for Harbor evaluation framework.
 * Episodes are stored in /logs/agent/episode-N/ format with:
 * - debug.json: LiteLLM-compatible request/response data
 * - response.txt: Assistant's text response
 * - prompt.txt: Latest user message
 *
 * Environment variables:
 * - CLINE_RECORD_EPISODES=true: Enable recording
 * - CLINE_EPISODE_LOGS_DIR=/path: Custom logs directory (default: /logs/agent)
 * - CLINE_EPISODE_USE_TASK_ID_FOLDER=true: Nest episodes under taskId subfolder
 */
export class EpisodeRecorder {
	private enabled: boolean
	private logsDir: string
	private useTaskIdFolder: boolean

	constructor(taskId?: string) {
		// Check environment variables
		this.enabled = process.env.CLINE_RECORD_EPISODES === "true"

		const baseDir = process.env.CLINE_EPISODE_LOGS_DIR || "/logs/agent"
		this.useTaskIdFolder = process.env.CLINE_EPISODE_USE_TASK_ID_FOLDER === "true"

		// If useTaskIdFolder is true and we have a taskId, nest under taskId
		this.logsDir = this.useTaskIdFolder && taskId ? path.join(baseDir, taskId) : baseDir
	}

	/**
	 * Gets the next episode number by counting existing episode-* directories.
	 * Uses filesystem as source of truth for robustness (survives crashes).
	 */
	private async getNextEpisodeNumber(): Promise<number> {
		try {
			const entries = await fs.readdir(this.logsDir, { withFileTypes: true })
			const episodeNumbers = entries
				.filter((e) => e.isDirectory() && e.name.startsWith("episode-"))
				.map((e) => parseInt(e.name.replace("episode-", "")))
				.filter((n) => !isNaN(n))

			return episodeNumbers.length > 0 ? Math.max(...episodeNumbers) + 1 : 0
		} catch {
			// Directory doesn't exist yet
			return 0
		}
	}

	/**
	 * Records an episode (API request/response pair) to disk.
	 * Fails silently to never interrupt the task.
	 */
	async recordEpisode(data: EpisodeData): Promise<void> {
		if (!this.enabled) {
			return
		}

		try {
			// Ensure logs directory exists
			await fs.mkdir(this.logsDir, { recursive: true })

			const episodeNum = await this.getNextEpisodeNumber()
			const episodeDir = path.join(this.logsDir, `episode-${episodeNum}`)
			await fs.mkdir(episodeDir, { recursive: true })

			// Create debug.json in Harbor/LiteLLM format
			const debugData = {
				litellm_trace_id: "None",
				litellm_call_id: crypto.randomUUID(),
				input: data.input,
				model: data.model,
				messages: data.input, // Duplicate for LiteLLM compatibility
				optional_params: {
					temperature: data.temperature ?? 0,
				},
				start_time: data.startTime.toISOString().replace("T", " ").replace("Z", ""),
				original_response: JSON.stringify({
					model: data.model,
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: data.response.text }, ...data.response.toolUses],
					usage: {
						input_tokens: data.usage.inputTokens,
						output_tokens: data.usage.outputTokens,
						cache_creation_input_tokens: data.usage.cacheWriteTokens,
						cache_read_input_tokens: data.usage.cacheReadTokens,
					},
				}),
				// Metadata
				provider: data.provider,
				cost_usd: data.totalCost,
			}

			await fs.writeFile(path.join(episodeDir, "debug.json"), JSON.stringify(debugData, null, 2))

			// Write response.txt
			await fs.writeFile(path.join(episodeDir, "response.txt"), data.response.text)

			// Write prompt.txt (last user message)
			const lastUserMsg = [...data.input].reverse().find((m) => m.role === "user")
			if (lastUserMsg) {
				const promptText = Array.isArray(lastUserMsg.content)
					? lastUserMsg.content
							.filter((b) => b.type === "text")
							.map((b) => (b as any).text)
							.join("\n\n")
					: lastUserMsg.content

				await fs.writeFile(path.join(episodeDir, "prompt.txt"), promptText)
			}
		} catch (error) {
			// Never crash the task - just log the error
			console.error("Failed to record episode:", error)
		}
	}
}
