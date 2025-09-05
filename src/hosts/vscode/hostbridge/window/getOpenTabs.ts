import { TabInputText, window } from "vscode"
import { GetOpenTabsRequest, GetOpenTabsResponse } from "@/shared/proto/host/window"
import { fileExistsAtPath } from "@/utils/fs"

export async function getOpenTabs(_: GetOpenTabsRequest): Promise<GetOpenTabsResponse> {
	const openTabs = window.tabGroups.all.flatMap((group) => group.tabs)

	// Filter out deleted files
	const filteredPaths = []
	for (const tab of openTabs) {
		const uri = (tab.input as TabInputText)?.uri
		const fsPath = uri?.fsPath
		if (!fsPath) {
			continue
		}

		if (uri.scheme === "file" && !(await fileExistsAtPath(fsPath))) {
			continue
		}

		filteredPaths.push(fsPath)
	}

	return GetOpenTabsResponse.create({ paths: filteredPaths })
}
