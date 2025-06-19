import { Controller } from ".."
import { RelativePathsRequest, RelativePaths } from "@shared/proto/file"
import { FileMethodHandler } from "./index"
import * as vscode from "vscode"
import * as path from "path"
import { Metadata, StringRequest } from "@shared/proto/common"
import { getHostBridgeProvider } from "@hosts/host-providers"

/**
 * Converts a list of URIs to workspace-relative paths
 * @param controller The controller instance
 * @param request The request containing URIs to convert
 * @returns Response with resolved relative paths
 */
export const getRelativePaths: FileMethodHandler = async (
	controller: Controller,
	request: RelativePathsRequest,
): Promise<RelativePaths> => {
	const resolvedPaths = await Promise.all(
		request.uris.map(async (uriString) => {
			try {
				// Use the host URI service client instead of directly using vscode.Uri.parse
				const parseResponse = await getHostBridgeProvider().uriServiceClient.parse(
					StringRequest.create({
						metadata: Metadata.create({}),
						value: uriString,
					}),
				)
				const fileUri = vscode.Uri.parse(`${parseResponse.scheme}://${parseResponse.authority}${parseResponse.path}`)
				console.log("[DEBUG] UriServiceClient.parse:", fileUri)
				const relativePathToGet = vscode.workspace.asRelativePath(fileUri, false)

				// If the path is still absolute, it's outside the workspace
				if (path.isAbsolute(relativePathToGet)) {
					console.warn(`Dropped file ${relativePathToGet} is outside the workspace. Sending original path.`)
					return fileUri.fsPath.replace(/\\/g, "/")
				} else {
					let finalPath = "/" + relativePathToGet.replace(/\\/g, "/")
					try {
						const stat = await vscode.workspace.fs.stat(fileUri)
						if (stat.type === vscode.FileType.Directory) {
							finalPath += "/"
						}
					} catch (statError) {
						console.error(`Error stating file ${fileUri.fsPath}:`, statError)
					}
					return finalPath
				}
			} catch (error) {
				console.error(`Error calculating relative path for ${uriString}:`, error)
				return null
			}
		}),
	)

	// Filter out any null values from errors
	const validPaths = resolvedPaths.filter((path): path is string => path !== null)

	return RelativePaths.create({ paths: validPaths })
}
