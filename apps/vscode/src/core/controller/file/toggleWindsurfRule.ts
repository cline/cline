import type { ToggleWindsurfRuleRequest } from "@shared/proto/cline/file"
import { ClineRulesToggles } from "@shared/proto/cline/file"
import type { Controller } from "../index"

export async function toggleWindsurfRule(
	_controller: Controller,
	_request: ToggleWindsurfRuleRequest,
): Promise<ClineRulesToggles> {
	return ClineRulesToggles.create({})
}
