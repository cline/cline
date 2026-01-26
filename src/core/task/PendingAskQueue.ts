import { ClineAskResponse } from "@shared/WebviewMessage"

/**
 * Represents a pending ask operation waiting for user response
 */
interface PendingAsk {
	askId: string
	askTs: number
	response?: ClineAskResponse
	text?: string
	images?: string[]
	files?: string[]
	resolved: boolean
}

/**
 * Manages concurrent ask operations with queue-based tracking.
 * Each ask gets a unique ID, allowing multiple asks to be pending simultaneously.
 * Responses are matched back to their corresponding asks.
 */
export class PendingAskQueue {
	private queue: Map<string, PendingAsk> = new Map()
	private lastMessageTs?: number

	/**
	 * Create a new pending ask and add it to the queue
	 * @returns The unique askId for this ask operation
	 */
	createPendingAsk(askTs: number): string {
		const askId = `ask-${askTs}-${Math.random().toString(36).substr(2, 9)}`
		this.queue.set(askId, {
			askId,
			askTs,
			resolved: false,
		})
		this.lastMessageTs = askTs
		return askId
	}

	/**
	 * Resolve a pending ask with user response
	 * @param askId The unique ID of the ask to resolve
	 * @param response The user's response
	 * @param text Optional text response
	 * @param images Optional image attachments
	 * @param files Optional file attachments
	 * @returns true if ask was found and resolved, false otherwise
	 */
	resolvePendingAsk(askId: string, response: ClineAskResponse, text?: string, images?: string[], files?: string[]): boolean {
		const pendingAsk = this.queue.get(askId)
		if (!pendingAsk) {
			return false
		}

		pendingAsk.response = response
		pendingAsk.text = text
		pendingAsk.images = images
		pendingAsk.files = files
		pendingAsk.resolved = true

		return true
	}

	/**
	 * Get the resolution status of a pending ask
	 * @param askId The unique ID of the ask
	 * @returns The ask object if found, undefined otherwise
	 */
	getPendingAsk(askId: string): PendingAsk | undefined {
		return this.queue.get(askId)
	}

	/**
	 * Remove a resolved ask from the queue
	 * @param askId The unique ID of the ask
	 */
	removePendingAsk(askId: string): void {
		this.queue.delete(askId)
	}

	/**
	 * Get all pending asks (those not yet resolved)
	 */
	getPendingAsks(): PendingAsk[] {
		return Array.from(this.queue.values()).filter((ask) => !ask.resolved)
	}

	/**
	 * Check if an ask was interrupted (another message came after it)
	 * @param askId The unique ID of the ask
	 * @returns true if this ask is no longer the most recent, false otherwise
	 */
	wasAskInterrupted(askId: string, currentLastMessageTs?: number): boolean {
		const pendingAsk = this.queue.get(askId)
		if (!pendingAsk) {
			return true // Ask was removed or never existed
		}

		// If currentLastMessageTs is provided and is different from this ask's ts,
		// then this ask was interrupted by another message
		if (currentLastMessageTs !== undefined && currentLastMessageTs !== pendingAsk.askTs) {
			return true
		}

		return false
	}

	/**
	 * Clear all pending asks (used on task abort)
	 */
	clear(): void {
		this.queue.clear()
		this.lastMessageTs = undefined
	}

	/**
	 * Get the last message timestamp
	 */
	getLastMessageTs(): number | undefined {
		return this.lastMessageTs
	}

	/**
	 * Set the last message timestamp (for tracking if asks were interrupted)
	 */
	setLastMessageTs(ts: number): void {
		this.lastMessageTs = ts
	}
}
