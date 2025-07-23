import { window, TabInputText } from "vscode"
import { GetOpenTabsRequest, GetOpenTabsResponse } from "@/shared/proto/host/window"

export async function getOpenTabs(_: GetOpenTabsRequest): Promise<GetOpenTabsResponse> {
	const openTabPaths = window.tabGroups.all
		.flatMap((group) => group.tabs)
		.map((tab) => (tab.input as TabInputText)?.uri?.fsPath)
		.filter(Boolean)

	return GetOpenTabsResponse.create({ paths: openTabPaths })
}
