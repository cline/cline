import type { ToggleClineRuleRequest } from "@shared/proto/cline/file"
import { ToggleClineRules } from "@shared/proto/cline/file"
import type { Controller } from "../index"

export async function toggleClineRule(_controller: Controller, _request: ToggleClineRuleRequest): Promise<ToggleClineRules> {
	return ToggleClineRules.create({})
}
