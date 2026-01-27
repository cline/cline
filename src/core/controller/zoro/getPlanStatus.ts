import { GetPlanStatusRequest, GetPlanStatusResponse } from "@shared/proto/cline/zoro"
import { Controller } from ".."
import { ZoroService } from "../../../services/zoro/ZoroService"

export async function getPlanStatus(controller: Controller, request: GetPlanStatusRequest): Promise<GetPlanStatusResponse> {
	try {
		const workspaceManager = await controller.ensureWorkspaceManager()
		const workspaceRoot = workspaceManager?.getPrimaryRoot()?.path
		if (!workspaceRoot) {
			return GetPlanStatusResponse.create({
				success: false,
				currentStep: "",
				totalSteps: 0,
				completedSteps: 0,
			})
		}

		const zoroService = new ZoroService(workspaceRoot)

		if (!zoroService.hasPlan()) {
			return GetPlanStatusResponse.create({
				success: false,
				currentStep: "",
				totalSteps: 0,
				completedSteps: 0,
			})
		}

		const stats = zoroService.getPlanStats(true)
		const currentStep = zoroService.getCurrentStep(true)

		return GetPlanStatusResponse.create({
			success: true,
			currentStep: currentStep?.id || "",
			totalSteps: stats.totalSteps,
			completedSteps: stats.completed,
		})
	} catch (error: any) {
		return GetPlanStatusResponse.create({
			success: false,
			currentStep: "",
			totalSteps: 0,
			completedSteps: 0,
		})
	}
}
