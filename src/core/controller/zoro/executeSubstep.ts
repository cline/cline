import { ExecuteSubstepRequest, ExecuteStepResponse } from "@shared/proto/cline/zoro"
import { Controller } from ".."
import * as fs from "fs"
import * as path from "path"

export async function executeSubstep(controller: Controller, request: ExecuteSubstepRequest): Promise<ExecuteStepResponse> {
	try {
		const workspaceManager = await controller.ensureWorkspaceManager()
		const workspaceRoot = workspaceManager?.getPrimaryRoot()?.path
		if (!workspaceRoot) {
			return ExecuteStepResponse.create({
				verdict: "unclear",
				message: "No workspace open",
				trackingCommands: [],
				actionText: "",
			})
		}

		const planPath = path.join(workspaceRoot, ".zoro/generated/assistant", request.chatId, "plan.json")

		if (!fs.existsSync(planPath)) {
			return ExecuteStepResponse.create({
				verdict: "unclear",
				message: `No Zoro plan found for chat ${request.chatId}`,
				trackingCommands: [],
				actionText: "",
			})
		}

		const planData = JSON.parse(fs.readFileSync(planPath, "utf-8"))
		const node = planData.nodes.find((n: any) => n.id === request.stepId)

		if (!node) {
			return ExecuteStepResponse.create({
				verdict: "unclear",
				message: `Step ${request.stepId} not found in plan`,
				trackingCommands: [],
				actionText: "",
			})
		}

		const substep = node.substeps?.find((s: any) => s.id === request.substepId)
		if (!substep) {
			return ExecuteStepResponse.create({
				verdict: "unclear",
				message: `Substep ${request.substepId} not found in ${request.stepId}`,
				trackingCommands: [],
				actionText: "",
			})
		}

		if (!controller.task) {
			return ExecuteStepResponse.create({
				verdict: "unclear",
				message: "No active Cline task. Start a task first, then execute Zoro substeps.",
				trackingCommands: [],
				actionText: "",
			})
		}

		if (substep.completed) {
			return ExecuteStepResponse.create({
				verdict: "done",
				message: `✓ Substep ${request.substepId} already completed`,
				trackingCommands: [],
				actionText: "",
			})
		}

		const substepContent = `Complete Zoro substep from ${request.stepId}:

${substep.text}`

		controller.task.taskState.zoroStepMode = true

		await controller.task.handleWebviewAskResponse("messageResponse", substepContent, [], [])

		const trackingCommands = [`zoro update-substep ${request.stepId} ${request.substepId} completed`]

		return ExecuteStepResponse.create({
			verdict: "not_done",
			message: `⚙️ Executing substep ${request.substepId} from ${request.stepId}`,
			trackingCommands: trackingCommands,
			actionText: "",
		})
	} catch (error: any) {
		return ExecuteStepResponse.create({
			verdict: "unclear",
			message: error.message || "Unknown error",
			trackingCommands: [],
			actionText: "",
		})
	}
}
