import * as vscode from "vscode"
import { Uri } from "../../../src/shared/proto/host/uri"
import { StringRequest } from "../../../src/shared/proto/common"

/**
 * Creates a file URI from a file path
 * @param request The request containing the file path
 * @returns A URI object representing the file
 */
export async function file(request: StringRequest): Promise<Uri> {
	const uri = vscode.Uri.file(request.value)
	return Uri.create({
		scheme: uri.scheme,
		authority: uri.authority,
		path: uri.path,
		query: uri.query,
		fragment: uri.fragment,
		fsPath: uri.fsPath,
	})
}
