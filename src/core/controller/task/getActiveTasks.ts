import { EmptyRequest } from "@shared/proto/cline/common"
import { ActiveTaskInfo, ActiveTasksResponse } from "@shared/proto/cline/task"
import { Controller } from ".."

/**
 * Get all currently active tasks
 * @param controller The controller instance
 * @param _request The empty request
 * @returns ActiveTasksResponse containing all active tasks
 */
export async function getActiveTasks(controller: Controller, _request: EmptyRequest): Promise<ActiveTasksResponse> {
	const activeTasks = controller.getActiveTasks()

	const tasks: ActiveTaskInfo[] = activeTasks.map((item) => {
		return ActiveTaskInfo.create({
			taskId: item.taskId,
			taskDescription: "",
			isStreaming: item.task.taskState.isStreaming,
		})
	})

	return ActiveTasksResponse.create({
		tasks,
		currentTaskId: controller.task?.taskId || "",
	})
}
