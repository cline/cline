import { ClineMessage } from "./ExtensionMessage"

/**
 * Consolidates error_retry messages in a retry sequence, keeping only the latest one,
 * and removes successful retry messages entirely.
 *
 * When an API request fails and auto-retry is enabled, multiple error_retry messages are created
 * (e.g., "Attempt 1 of 3", "Attempt 2 of 3", "Attempt 3 of 3"), interleaved with api_req_retried
 * messages. This function:
 * 1. Filters out earlier retry messages, showing only the most recent one
 * 2. Removes error_retry messages entirely when followed by a successful api_req_started
 *    (indicating the retry succeeded)
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A new array of ClineMessage objects with error_retry sequences consolidated.
 *
 * @example
 * // During retry sequence - shows only latest attempt:
 * const messages: ClineMessage[] = [
 *   { type: 'say', say: 'error_retry', text: '{"attempt":1,"maxAttempts":3}', ts: 1000 },
 *   { type: 'say', say: 'api_req_retried', ts: 1001 },
 *   { type: 'say', say: 'error_retry', text: '{"attempt":2,"maxAttempts":3}', ts: 1002 },
 *   { type: 'say', say: 'api_req_retried', ts: 1003 },
 *   { type: 'say', say: 'error_retry', text: '{"attempt":3,"maxAttempts":3}', ts: 1004 },
 * ];
 * const result = combineErrorRetryMessages(messages);
 * // Result: [{ type: 'say', say: 'error_retry', text: '{"attempt":3,"maxAttempts":3}', ts: 1004 }]
 *
 * @example
 * // After successful retry - removes error_retry entirely:
 * const messages: ClineMessage[] = [
 *   { type: 'say', say: 'error_retry', text: '{"attempt":1,"maxAttempts":3}', ts: 1000 },
 *   { type: 'say', say: 'api_req_retried', ts: 1001 },
 *   { type: 'say', say: 'api_req_started', text: '{}', ts: 1002 },
 * ];
 * const result = combineErrorRetryMessages(messages);
 * // Result: [{ type: 'say', say: 'api_req_started', text: '{}', ts: 1002 }]
 */
export function combineErrorRetryMessages(messages: ClineMessage[]): ClineMessage[] {
	const result: ClineMessage[] = []

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i]

		if (message.say === "error_retry") {
			// Look ahead to see what follows this error_retry
			let nextIndex = i + 1
			let nextMessage = messages[nextIndex]

			// Skip over api_req_retried to find the meaningful next message
			if (nextMessage?.say === "api_req_retried") {
				nextIndex++
				nextMessage = messages[nextIndex]
			}

			// Case 1: Another error_retry follows - skip this one, show the later one
			if (nextMessage?.say === "error_retry") {
				continue
			}

			// Case 2: api_req_started follows - retry succeeded, don't show the error_retry
			// (unless it has failed: true, meaning all retries were exhausted)
			if (nextMessage?.say === "api_req_started") {
				try {
					const retryInfo = JSON.parse(message.text || "{}")
					// Only skip if this wasn't a final failure message
					if (!retryInfo.failed) {
						continue
					}
				} catch {
					// If we can't parse, still skip to be safe
					continue
				}
			}
		}

		result.push(message)
	}

	return result
}
