import { window } from "vscode"
import { GetVisibleTabsRequest, GetVisibleTabsResponse } from "@/shared/proto/host/window"
import { fileExistsAtPath } from "@/utils/fs"

export async function getVisibleTabs(_: GetVisibleTabsRequest): Promise<GetVisibleTabsResponse> {
	const visibleEditors = window.visibleTextEditors || []

	// Filter out deleted files
	const filteredPaths = []
	for (const editor of visibleEditors) {
		const uri = editor.document?.uri
		const fsPath = uri?.fsPath
		if (!fsPath) {
			continue
		}

		if (uri.scheme === "file" && !(await fileExistsAtPath(fsPath))) {
			continue
		}

		filteredPaths.push(fsPath)
	}

	return GetVisibleTabsResponse.create({ paths: filteredPaths })
}
