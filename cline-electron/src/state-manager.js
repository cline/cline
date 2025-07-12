class StateManager {
	constructor() {
		this.stateSubscriptions = []
	}

	// Helper function to broadcast state updates to all subscriptions
	async broadcastStateUpdate(reason = "unknown") {
		if (global.stateSubscriptions && global.stateSubscriptions.length > 0) {
			// console.log(`📡 Broadcasting state update (${reason}) to ${global.stateSubscriptions.length} subscriptions`); // Disabled to reduce console noise
			for (const subscription of global.stateSubscriptions) {
				try {
					const currentState = await subscription.controller.getStateToPostToWebview()
					const currentStateJson = JSON.stringify(currentState)
					await subscription.responseStream({ stateJson: currentStateJson })
					// console.log(`📡 Sent state update to subscription ${subscription.request_id}`); // Disabled to reduce console noise
				} catch (error) {
					console.error("📡 Error sending state update:", error)
				}
			}
		}
	}

	// Add a subscription to the global list
	addSubscription(subscription) {
		global.stateSubscriptions = global.stateSubscriptions || []
		global.stateSubscriptions.push(subscription)
	}

	// Remove a subscription from the global list
	removeSubscription(request_id) {
		if (global.stateSubscriptions) {
			global.stateSubscriptions = global.stateSubscriptions.filter((s) => s.request_id !== request_id)
		}
	}

	// Get all current subscriptions
	getSubscriptions() {
		return global.stateSubscriptions || []
	}

	// Clear all subscriptions
	clearSubscriptions() {
		global.stateSubscriptions = []
	}
}

module.exports = StateManager
