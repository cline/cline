import { instanceUsageTracker } from "@core/services/instance-usage/InstanceUsageTracker"
import { EmptyRequest } from "@shared/proto/cline/common"
import { InstanceUsage } from "@shared/proto/cline/state"
import { Controller } from ".."

/**
 * Returns usage/introspection data for orchestration (e.g., CLI instance cleanup).
 */
export async function getInstanceUsage(_controller: Controller, _request: EmptyRequest): Promise<InstanceUsage> {
	const activeTasks = _controller.task ? 1 : 0
	return InstanceUsage.create({
		activeTasks,
		activeConnections: instanceUsageTracker.getActiveConnections(),
		lastActivityTsMs: instanceUsageTracker.getLastActivityTsMs(),
	})
}
