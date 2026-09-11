import { type SessionSearchHit, SessionHistorySearchService } from "@cline/core"
import type { SdkTaskHistory } from "./sdk-task-history"

export type { SessionSearchHit }

const DEFAULT_SEARCH_LIMIT = 50

/**
 * Full-text search over task history content ("advanced search"), layered on top of
 * the existing title/prompt-only search in SdkController.getTaskHistory rather than
 * replacing it. Wraps the SDK's session-search FTS5 index around SdkTaskHistory so it
 * covers both SDK-native sessions and legacy pre-SDK tasks.
 *
 * The index is built lazily on the first search rather than at extension activation,
 * so a VS Code window that never opens Advanced search never pays the indexing cost.
 */
export class SdkTaskHistorySearch {
	private readonly service: SessionHistorySearchService
	private started = false

	constructor(taskHistory: SdkTaskHistory) {
		this.service = new SessionHistorySearchService({
			listSessions: (limit) => taskHistory.listHistory({ hydrate: false, limit }),
			readSessionMessages: (sessionId) => taskHistory.getSearchableMessages(sessionId),
		})
	}

	private async ensureStarted(): Promise<void> {
		if (this.started) {
			return
		}
		this.started = true
		this.service.start()
		await this.service.waitUntilReady()
	}

	async search(query: string, limit: number = DEFAULT_SEARCH_LIMIT): Promise<SessionSearchHit[]> {
		if (!query.trim()) {
			return []
		}
		await this.ensureStarted()
		return this.service.search({ query, limit })
	}

	/**
	 * Reconciles the index against current task history immediately rather than
	 * waiting for the periodic timer. Safe to call even before the first search
	 * (e.g. right after a task finishes) — it's a no-op if the index was never
	 * initialized and otherwise just picks up whatever changed.
	 */
	refreshNow(): void {
		this.service.refreshNow().catch(() => undefined)
	}

	/** Evicts one task from the index without a full reconciliation, e.g. on delete. */
	removeSession(sessionId: string): void {
		try {
			this.service.removeSession(sessionId)
		} catch {
			// Best-effort eviction; the next reconciliation pass retries it.
		}
	}

	async dispose(): Promise<void> {
		await this.service.dispose()
	}
}
