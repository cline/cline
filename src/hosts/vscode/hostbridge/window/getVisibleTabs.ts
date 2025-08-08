import { GetVisibleTabsRequest, GetVisibleTabsResponse } from "@/shared/proto/host/window"
import { window } from "vscode"

export async function getVisibleTabs(_: GetVisibleTabsRequest): Promise<GetVisibleTabsResponse> {
	const visibleTabPaths = window.visibleTextEditors?.map((editor) => editor.document?.uri?.fsPath).filter(Boolean)

	return GetVisibleTabsResponse.create({ paths: visibleTabPaths })
}
