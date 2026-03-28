import { runKiroCli } from "@/integrations/kiro-cli/run"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { type ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import type { ApiStream } from "../transform/stream"

interface KiroCliHandlerOptions extends CommonApiHandlerOptions {
	kiroCliPath?: string
	apiModelId?: string
}

const DEFAULT_KIRO_MODEL_ID = "kiro-cli-auto"

export class KiroCliHandler implements ApiHandler {
	constructor(private readonly options: KiroCliHandlerOptions) {}

	@withRetry({
		maxRetries: 2,
		baseDelay: 1500,
		maxDelay: 5000,
	})
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		for await (const chunk of runKiroCli({
			systemPrompt,
			messages,
			path: this.options.kiroCliPath,
		})) {
			yield {
				type: "text",
				text: chunk,
			}
		}
	}

	getModel() {
		return {
			id: this.options.apiModelId || DEFAULT_KIRO_MODEL_ID,
			info: {
				maxTokens: 0,
				contextWindow: 0,
				supportsImages: false,
				supportsPromptCache: false,
				supportsReasoning: false,
				description: "Kiro CLI non-interactive runtime.",
			},
		}
	}
}
