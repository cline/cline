import { ExecuteStepRequest, ExecuteStepResponse } from "@shared/proto/cline/zoro"
import { Controller } from ".."
import * as fs from "fs"
import * as path from "path"

export async function executeStep(controller: Controller, request: ExecuteStepRequest): Promise<ExecuteStepResponse> {
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

		if (!controller.task) {
			return ExecuteStepResponse.create({
				verdict: "unclear",
				message: "No active Cline task. Start a task first, then execute Zoro steps.",
				trackingCommands: [],
				actionText: "",
			})
		}

		if (node.status === "completed") {
			return ExecuteStepResponse.create({
				verdict: "done",
				message: `✓ Step ${request.stepId} already completed`,
				trackingCommands: [],
				actionText: "",
			})
		}

		const rulesText = node.rules.map((r: any) => `${r.name}\nReasoning: ${r.source}`).join("\n\n")

		const taskContent = `Execute Zoro step: [${node.type}] ${node.description}

Rules to follow:
${rulesText}`

		// Set flag to stop Cline after this step completes
		controller.task.taskState.zoroStepMode = true

		await controller.task.handleWebviewAskResponse("messageResponse", taskContent, [], [])

		const trackingCommands = [
			`zoro update-step ${request.stepId} in_progress`,
			`zoro add-note ${request.stepId} "Executed by Cline"`,
			`zoro complete-step ${request.stepId}`,
		]

		return ExecuteStepResponse.create({
			verdict: "not_done",
			message: `⚙️ Executing ${request.stepId}: ${node.description}`,
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
