import * as vscode from "vscode"
import { ParseRequest, Uri } from "../../../src/shared/proto/host/uri"

/**
 * Parses a string URI into a Uri object
 * @param request The request containing the URI string
 * @returns A URI object representing the parsed URI
 */
export async function parse(request: ParseRequest): Promise<Uri> {
	const uri = vscode.Uri.parse(request.uri)
	return {
		scheme: uri.scheme,
		authority: uri.authority,
		path: uri.path,
		query: uri.query,
		fragment: uri.fragment,
		fsPath: uri.fsPath,
	}
}
