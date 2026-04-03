// Workflows have been removed. Stub for compilation compatibility.
import type { ClineRulesToggles } from "@shared/cline-rules"

// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
export async function refreshWorkflowToggles(_controller: any, _cwd: string): Promise<{ localWorkflowToggles: ClineRulesToggles; globalWorkflowToggles: ClineRulesToggles }> {
	return { localWorkflowToggles: {}, globalWorkflowToggles: {} }
}
