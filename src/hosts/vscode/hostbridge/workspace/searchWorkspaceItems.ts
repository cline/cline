import { basename } from "path"
import * as vscode from "vscode"
import { searchWorkspaceFiles } from "@/services/search/file-search"
import {
	SearchWorkspaceItemsRequest,
	SearchWorkspaceItemsRequest_SearchItemType,
	SearchWorkspaceItemsResponse,
} from "@/shared/proto/index.host"

export async function searchWorkspaceItems(request: SearchWorkspaceItemsRequest): Promise<SearchWorkspaceItemsResponse> {
	const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	if (!workspacePath) {
		return SearchWorkspaceItemsResponse.create({ items: [] })
	}

	let selectedTypeString: "file" | "folder" | undefined
	if (request.selectedType === SearchWorkspaceItemsRequest_SearchItemType.FILE) {
		selectedTypeString = "file"
	} else if (request.selectedType === SearchWorkspaceItemsRequest_SearchItemType.FOLDER) {
		selectedTypeString = "folder"
	}

	const results = await searchWorkspaceFiles(request.query || "", workspacePath, request.limit || 20, selectedTypeString)

	return SearchWorkspaceItemsResponse.create({
		items: results.map((r) => ({
			path: r.path,
			type:
				r.type === "folder"
					? SearchWorkspaceItemsRequest_SearchItemType.FOLDER
					: SearchWorkspaceItemsRequest_SearchItemType.FILE,
			label: r.label ?? basename(r.path),
		})),
	})
}
