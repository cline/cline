import { GetWorkspacePathsRequest, GetWorkspacePathsResponse } from "@/shared/proto/index.host"
import * as vscode from "vscode"
export async function getWorkspacePaths(_: GetWorkspacePathsRequest): Promise<GetWorkspacePathsResponse> {
	const paths = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []
	return GetWorkspacePathsResponse.create({ paths: paths })
}
