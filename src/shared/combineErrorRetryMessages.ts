import { ClineMessage } from "./ExtensionMessage"

/**
 * Consolidates error_retry messages in a retry sequence, keeping only the latest one.
 *
 * When an API request fails and auto-retry is enabled, multiple error_retry messages are created
 * (e.g., "Attempt 1 of 3", "Attempt 2 of 3", "Attempt 3 of 3"), interleaved with api_req_retried
 * messages. This function filters out earlier retry messages, showing only the most recent one.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A new array of ClineMessage objects with error_retry sequences consolidated.
 *
 * @example
 * const messages: ClineMessage[] = [
 *   { type: 'say', say: 'error_retry', text: '{"attempt":1,"maxAttempts":3}', ts: 1000 },
 *   { type: 'say', say: 'api_req_retried', ts: 1001 },
 *   { type: 'say', say: 'error_retry', text: '{"attempt":2,"maxAttempts":3}', ts: 1002 },
 *   { type: 'say', say: 'api_req_retried', ts: 1003 },
 *   { type: 'say', say: 'error_retry', text: '{"attempt":3,"maxAttempts":3}', ts: 1004 },
 * ];
 * const result = combineErrorRetryMessages(messages);
 * // Result: [{ type: 'say', say: 'error_retry', text: '{"attempt":3,"maxAttempts":3}', ts: 1004 }]
 */
export function combineErrorRetryMessages(messages: ClineMessage[]): ClineMessage[] {
	const result: ClineMessage[] = []

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i]

		if (message.say === "error_retry") {
			// Look ahead to see if the next non-api_req_retried message is also an error_retry
			let nextMessage = messages[i + 1]
			if (nextMessage?.say === "api_req_retried") {
				nextMessage = messages[i + 2]
			}
			if (nextMessage?.say === "error_retry") {
				// Skip this message, we'll show the next one (or a later one in the sequence)
				continue
			}
		}

		result.push(message)
	}

	return result
}
