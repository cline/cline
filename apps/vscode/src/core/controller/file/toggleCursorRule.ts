import type { ToggleCursorRuleRequest } from "@shared/proto/cline/file"
import { ClineRulesToggles } from "@shared/proto/cline/file"
import type { Controller } from "../index"

export async function toggleCursorRule(_controller: Controller, _request: ToggleCursorRuleRequest): Promise<ClineRulesToggles> {
	return ClineRulesToggles.create({})
}
