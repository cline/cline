import type { ToggleAgentsRuleRequest } from "@shared/proto/cline/file"
import { ClineRulesToggles } from "@shared/proto/cline/file"
import type { Controller } from "../index"

export async function toggleAgentsRule(_controller: Controller, _request: ToggleAgentsRuleRequest): Promise<ClineRulesToggles> {
	return ClineRulesToggles.create({})
}
