import * as vscode from "vscode"

import type { OpenInFileExplorerPanelRequest, OpenInFileExplorerPanelResponse } from "@/shared/proto/index.host"

export async function openInFileExplorerPanel(request: OpenInFileExplorerPanelRequest): Promise<OpenInFileExplorerPanelResponse> {
	vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(request.path || ""))
	return {}
}
