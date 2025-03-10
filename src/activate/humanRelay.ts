// Callback mapping of human relay response.
const humanRelayCallbacks = new Map<string, (response: string | undefined) => void>()

/**
 * Register a callback function for human relay response.
 * @param requestId
 * @param callback
 */
export const registerHumanRelayCallback = (requestId: string, callback: (response: string | undefined) => void) =>
	humanRelayCallbacks.set(requestId, callback)

export const unregisterHumanRelayCallback = (requestId: string) => humanRelayCallbacks.delete(requestId)

export const handleHumanRelayResponse = (response: { requestId: string; text?: string; cancelled?: boolean }) => {
	const callback = humanRelayCallbacks.get(response.requestId)

	if (callback) {
		if (response.cancelled) {
			callback(undefined)
		} else {
			callback(response.text)
		}

		humanRelayCallbacks.delete(response.requestId)
	}
}
