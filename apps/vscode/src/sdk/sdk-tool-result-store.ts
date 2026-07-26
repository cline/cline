export interface StoredToolResult {
	id: string
	sessionId: string
	toolCallId?: string
	toolName: string
	content: string
	isError: boolean
	truncated: boolean
	createdAt: number
}

export interface ToolResultReference {
	id: string
	preview: string
	truncated: boolean
	isError: boolean
}

const DEFAULT_PREVIEW_CHARS = 2_000
const DEFAULT_MAX_RESULT_CHARS = 1_000_000
const DEFAULT_MAX_ENTRIES = 200

/** Host-owned, bounded retention for output that must not be copied into chat state. */
export class SdkToolResultStore {
	private readonly results = new Map<string, StoredToolResult>()

	constructor(
		private readonly options: {
			previewChars?: number
			maxResultChars?: number
			maxEntries?: number
		} = {},
	) {}

	put(input: {
		sessionId: string
		toolCallId?: string
		toolName: string
		content: string
		isError?: boolean
	}): ToolResultReference {
		const maxResultChars = this.options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS
		const truncated = input.content.length > maxResultChars
		const content = truncated ? input.content.slice(0, maxResultChars) : input.content
		const id = crypto.randomUUID()
		const result: StoredToolResult = {
			id,
			sessionId: input.sessionId,
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			content,
			isError: input.isError ?? false,
			truncated,
			createdAt: Date.now(),
		}
		this.results.set(id, result)
		this.prune()
		return {
			id,
			preview: compactToolResultPreview(content, this.options.previewChars),
			truncated,
			isError: result.isError,
		}
	}

	get(id: string): StoredToolResult | undefined {
		const value = this.results.get(id)
		return value ? { ...value } : undefined
	}

	clear(): void {
		this.results.clear()
	}

	private prune(): void {
		const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES
		while (this.results.size > maxEntries) {
			const oldest = this.results.keys().next().value
			if (oldest === undefined) break
			this.results.delete(oldest)
		}
	}
}

export function compactToolResultPreview(content: string, previewChars = DEFAULT_PREVIEW_CHARS): string {
	if (content.length <= previewChars) return content
	return `${content.slice(0, previewChars)}\n… output preview truncated`
}
