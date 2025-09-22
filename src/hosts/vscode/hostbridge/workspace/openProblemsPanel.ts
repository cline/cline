import * as vscode from "vscode"
import type { OpenProblemsPanelRequest, OpenProblemsPanelResponse } from "@/shared/proto/index.host"

export async function openProblemsPanel(_: OpenProblemsPanelRequest): Promise<OpenProblemsPanelResponse> {
	vscode.commands.executeCommand("workbench.actions.view.problems")
	return {}
}
