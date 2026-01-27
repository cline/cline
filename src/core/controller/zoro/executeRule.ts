import { ExecuteRuleRequest, ExecuteStepResponse } from "@shared/proto/cline/zoro"
import { Controller } from ".."
import * as fs from "fs"
import * as path from "path"

export async function executeRule(controller: Controller, request: ExecuteRuleRequest): Promise<ExecuteStepResponse> {
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

		const rule = node.rules.find((r: any) => r.rule_id === request.ruleId)
		if (!rule) {
			return ExecuteStepResponse.create({
				verdict: "unclear",
				message: `Rule ${request.ruleId} not found in ${request.stepId}`,
				trackingCommands: [],
				actionText: "",
			})
		}

		if (!controller.task) {
			return ExecuteStepResponse.create({
				verdict: "unclear",
				message: "No active Cline task. Start a task first, then execute Zoro rules.",
				trackingCommands: [],
				actionText: "",
			})
		}

		const ruleContent = `Apply Zoro rule from ${request.stepId}:

${rule.description}

Reasoning: ${rule.source}`

		controller.task.taskState.zoroStepMode = true

		await controller.task.handleWebviewAskResponse("messageResponse", ruleContent, [], [])

		const trackingCommands = [`zoro add-note ${request.stepId} "Applied rule: ${request.ruleId}"`]

		return ExecuteStepResponse.create({
			verdict: "not_done",
			message: `⚙️ Applying rule ${request.ruleId} from ${request.stepId}`,
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
