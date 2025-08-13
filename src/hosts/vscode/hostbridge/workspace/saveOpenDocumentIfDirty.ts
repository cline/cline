import { arePathsEqual } from "@utils/path"
import * as vscode from "vscode"
import { SaveOpenDocumentIfDirtyRequest, SaveOpenDocumentIfDirtyResponse } from "@/shared/proto/index.host"

export async function saveOpenDocumentIfDirty(request: SaveOpenDocumentIfDirtyRequest): Promise<SaveOpenDocumentIfDirtyResponse> {
	const existingDocument = vscode.workspace.textDocuments.find((doc) => arePathsEqual(doc.uri.fsPath, request.filePath))
	if (existingDocument && existingDocument.isDirty) {
		await existingDocument.save()
		return { wasSaved: true }
	}
	return {}
}
