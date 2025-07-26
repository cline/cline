import { Controller } from "../index"
import { EmptyRequest, String } from "@shared/proto/cline/common"
import { StreamingResponseHandler, getRequestRegistry } from "../grpc-handler"
import { getTheme } from "@integrations/theme/getTheme"

// Keep track of active theme subscriptions
const activeThemeSubscriptions = new Set<StreamingResponseHandler<String>>()

/**
 * Subscribe to theme change events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToTheme(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<String>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeThemeSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeThemeSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "theme_subscription" }, responseStream)
	}

	// Send the current theme immediately upon subscription
	const theme = await getTheme()
	if (theme) {
		try {
			const themeEvent = String.create({
				value: JSON.stringify(theme),
			})
			await responseStream(
				themeEvent,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending initial theme:", error)
			activeThemeSubscriptions.delete(responseStream)
		}
	}
}

/**
 * Send a theme event to all active subscribers
 * @param themeJson The JSON-stringified theme data
 */
export async function sendThemeEvent(themeJson: string): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeThemeSubscriptions).map(async (responseStream) => {
		try {
			const event = String.create({
				value: themeJson,
			})
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending theme event:", error)
			// Remove the subscription if there was an error
			activeThemeSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
