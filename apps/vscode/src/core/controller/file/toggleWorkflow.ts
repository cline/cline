import { ClineRulesToggles, ToggleWorkflowRequest } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function toggleWorkflow(_controller: Controller, _request: ToggleWorkflowRequest): Promise<ClineRulesToggles> {
	return ClineRulesToggles.create({})
}
