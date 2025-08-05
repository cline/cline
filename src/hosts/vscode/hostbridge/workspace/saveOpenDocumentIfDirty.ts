import { SaveOpenDocumentIfDirtyRequest, SaveOpenDocumentIfDirtyResponse } from "@/shared/proto/index.host"
import * as vscode from "vscode"
import { arePathsEqual } from "@utils/path"

export async function saveOpenDocumentIfDirty(request: SaveOpenDocumentIfDirtyRequest): Promise<SaveOpenDocumentIfDirtyResponse> {
	const existingDocument = vscode.workspace.textDocuments.find((doc) => arePathsEqual(doc.uri.fsPath, request.filePath))
	if (existingDocument && existingDocument.isDirty) {
		await existingDocument.save()
		return { wasSaved: true }
	}
	return {}
}
