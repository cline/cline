import { SearchWorkspaceItemsRequest, SearchWorkspaceItemsResponse } from "@/shared/proto/host/workspace"

export async function searchWorkspaceItems(_request: SearchWorkspaceItemsRequest): Promise<SearchWorkspaceItemsResponse> {
	throw new Error("searchWorkspaceItems is not implemented on the VS Code host")
}
