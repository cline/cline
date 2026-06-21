import { FileSearchRequest, FileSearchResults } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function searchFiles(_controller: Controller, _request: FileSearchRequest): Promise<FileSearchResults> {
	return FileSearchResults.create({})
}
