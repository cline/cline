import type { TaskConfig } from "../TaskConfig"
import type { ApiStream } from "@api/transform/stream"

/**
 * ApiRequestManager (skeleton)
 * - No behavior changes. Not wired yet.
 * - Will encapsulate request creation, streaming iteration, retries, and error handling.
 */
export class ApiRequestManager {
	constructor(private readonly config: TaskConfig) {}

	/**
	 * In a later phase, this will construct the system prompt and context,
	 * call into the provider API, and return an async iterator over chunks.
	 */
	async *makeRequest(_userContent: unknown): AsyncGenerator<unknown, void, unknown> {
		// Skeleton: delegate to the current implementation later.
		// For now, yield nothing to keep it inert and safe if accidentally used.
		if (false) {
			yield {}
		}
	}

	/**
	 * Cancel an in-flight request (to be implemented when wiring streaming).
	 */
	async cancel(): Promise<void> {
		// no-op skeleton
	}

	/**
	 * Centralized error classification/formatting hooks will live here.
	 */
	async handleError(_error: unknown): Promise<void> {
		// no-op skeleton
	}
}

export type { ApiStream }
