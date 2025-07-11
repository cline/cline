import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import * as vscode from "vscode"
import * as path from "path"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { ShowTextDocumentOptions, ShowTextDocumentRequest } from "@/shared/proto/host/window"
import { arePathsEqual } from "@/utils/path"

export class ExternalDiffViewProvider extends DiffViewProvider {
	//private currentvscode.TextEditor
	// async openDiffEditor(): Promise<vscode.TextEditor> {
	// 	if (!this.relPath) {
	// 		throw new Error("No file path set")
	// 	}
	// 	//openDiffEditor(absolutePath, content)
	// 	return await vscode.workspace.openTextDocument({
	// 		content: "initial content",
	// 		language: "javascript",
	// 	})
	// }
}
