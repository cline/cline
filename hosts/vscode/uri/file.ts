import * as vscode from "vscode"
import { FileRequest, Uri } from "../../../src/shared/proto/host/uri"

/**
 * Creates a file URI from a file path
 * @param request The request containing the file path
 * @returns A URI object representing the file
 */
export async function file(request: FileRequest): Promise<Uri> {
	const uri = vscode.Uri.file(request.path)
	return {
		scheme: uri.scheme,
		authority: uri.authority,
		path: uri.path,
		query: uri.query,
		fragment: uri.fragment,
		fsPath: uri.fsPath,
	}
}
