import * as vscode from "vscode"
import { GetOpenTabsRequest, GetOpenTabsResponse } from "@/shared/proto/host/window"

export async function getOpenTabs(_: GetOpenTabsRequest): Promise<GetOpenTabsResponse> {
	const openTabPaths = vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.map((tab) => {
			const input = tab.input as any
			if (!input) {
				return undefined
			}

			// Try to get URI from common input types (Text, Untitled, Custom, Notebook, etc.)
			// Most have a .uri property, while diff inputs have .original and .modified
			const uri =
				input.uri instanceof vscode.Uri ? input.uri : input.modified instanceof vscode.Uri ? input.modified : undefined

			if (uri) {
				// Use fsPath if available, fallback to path for untitled documents or non-file schemes
				return uri.fsPath || uri.path
			}

			return undefined
		})
		.filter((path): path is string => !!path)

	return GetOpenTabsResponse.create({ paths: openTabPaths })
}
