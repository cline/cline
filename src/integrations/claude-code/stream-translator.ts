import type { RuntimeStreamTranslator } from "@/core/api/runtime/stream-translator"
import { Logger } from "@/shared/services/Logger"
import type { ClaudeCodeMessage } from "./types"

const attemptParseChunk = (data: string): ClaudeCodeMessage | null => {
	try {
		return JSON.parse(data)
	} catch (error) {
		Logger.error("Error parsing chunk:", error, data.length)
		return null
	}
}

export class ClaudeCodeStreamTranslator implements RuntimeStreamTranslator<ClaudeCodeMessage | string> {
	private partialData: string | null = null

	translateStdout(line: string): Array<ClaudeCodeMessage | string> {
		if (this.partialData) {
			this.partialData += line
			const chunk = attemptParseChunk(this.partialData)
			if (!chunk) {
				return []
			}

			this.partialData = null
			return [chunk]
		}

		const chunk = attemptParseChunk(line)
		if (!chunk) {
			this.partialData = line
			return []
		}

		return [chunk]
	}

	flush(): Array<ClaudeCodeMessage | string> {
		if (!this.partialData || !this.partialData.startsWith(`{"type":"assistant"`)) {
			return []
		}

		const chunk = this.partialData
		this.partialData = null
		return [chunk]
	}
}
