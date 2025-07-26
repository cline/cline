import { SaveOpenDocumentIfDirtyRequest } from "@/shared/proto/index.host"
import { Empty } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { arePathsEqual } from "@utils/path"

export async function saveOpenDocumentIfDirty(request: SaveOpenDocumentIfDirtyRequest): Promise<Empty> {
	const existingDocument = vscode.workspace.textDocuments.find((doc) => arePathsEqual(doc.uri.fsPath, request.filePath))

	if (existingDocument && existingDocument.isDirty) {
		await existingDocument.save()
	}

	return Empty.create({})
}
