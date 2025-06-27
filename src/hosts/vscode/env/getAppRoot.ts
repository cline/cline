import * as vscode from "vscode"
import { EmptyRequest, String } from "../../../shared/proto/common"

/**
 * VSCode implementation of getting the application root directory path
 * @param request Empty request
 * @returns Promise resolving to the VSCode application root path
 */
export async function getAppRoot(request: EmptyRequest): Promise<String> {
	return String.create({
		value: vscode.env.appRoot,
	})
}
