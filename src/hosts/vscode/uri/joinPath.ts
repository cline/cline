import * as vscode from "vscode"
import { JoinPathRequest, Uri } from "@shared/proto/host/uri"

/**
 * Joins a URI with additional path segments
 * @param request The request containing the base URI and path segments
 * @returns A new URI with the path segments joined
 */
export async function joinPath(request: JoinPathRequest): Promise<Uri> {
	// Convert proto Uri to vscode.Uri
	if (!request.base) {
		throw new Error("Base URI is required")
	}
	const baseUri = vscode.Uri.parse(`${request.base.scheme}://${request.base.authority}${request.base.path}`)

	// Join paths
	const result = vscode.Uri.joinPath(baseUri, ...request.pathSegments)

	// Convert back to proto Uri
	return Uri.create({
		scheme: result.scheme,
		authority: result.authority,
		path: result.path,
		query: result.query,
		fragment: result.fragment,
		fsPath: result.fsPath,
	})
}
