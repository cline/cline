import { getRequestRegistry } from "@core/controller/grpc-handler"

/**
 * Tracks coarse instance usage for orchestration (CLI idle cleanup).
 *
 * Signals:
 * - activeTasks: whether a Task object is currently initialized on the Controller
 * - activeConnections: number of active gRPC requests/subscriptions in the request registry
 * - lastActivityTsMs: timestamp of last meaningful activity
 */
export class InstanceUsageTracker {
	private lastActivityTsMs = Date.now()

	markActivity(ts = Date.now()) {
		this.lastActivityTsMs = ts
	}

	getLastActivityTsMs(): number {
		return this.lastActivityTsMs
	}

	getActiveConnections(): number {
		// The request registry contains unary + streaming requests.
		// This is a coarse but useful signal for “frontends attached / doing work”.
		return getRequestRegistry().getAllRequests().length
	}
}

export const instanceUsageTracker = new InstanceUsageTracker()
