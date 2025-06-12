import * as vscode from "vscode"
import { Uri } from "@shared/proto/host/uri"
import { StringRequest } from "@shared/proto/common"

/**
 * Parses a string URI into a Uri object
 * @param request The request containing the URI string
 * @returns A URI object representing the parsed URI
 */
export async function parse(request: StringRequest): Promise<Uri> {
	const uri = vscode.Uri.parse(request.value)
	return Uri.create({
		scheme: uri.scheme,
		authority: uri.authority,
		path: uri.path,
		query: uri.query,
		fragment: uri.fragment,
		fsPath: uri.fsPath,
	})
}
