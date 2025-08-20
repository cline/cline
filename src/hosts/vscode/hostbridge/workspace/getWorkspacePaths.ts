import * as vscode from "vscode"
import { GetWorkspacePathsRequest, GetWorkspacePathsResponse } from "@/shared/proto/index.host"
export async function getWorkspacePaths(_: GetWorkspacePathsRequest): Promise<GetWorkspacePathsResponse> {
	const paths = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []
	return GetWorkspacePathsResponse.create({ paths: paths })
}
